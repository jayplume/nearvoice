//! Nearvoice invoices.
//!
//! An invoice is public about what a bookkeeper must be able to prove (who is
//! owed, how much, in which token, by when, and its status) and private about
//! everything else: the line items, client details and notes are encrypted in
//! the browser and stored here only as ciphertext (`sealed`) plus a SHA-256
//! fingerprint of the plaintext (`digest`), so a decrypted copy can be checked
//! against the chain.
//!
//! Money only moves through NEP-141 `ft_transfer_call` into this contract:
//! * `{"pay": id}` settles an open invoice in the same transaction, marks it
//!   paid, and splits the money between the invoice's recipients;
//! * `{"refund": id}` lets the issuer send a paid invoice's amount back, which
//!   is forwarded to the payer and marks the invoice refunded.
//!
//! Each business can pause itself (kill switch), cap invoice size and set its
//! default revenue split. The contract has no admin; accepted tokens are fixed
//! at `new`.

use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

pub const BPS: u128 = 10_000;
pub const MAX_SPLITS: usize = 5;
pub const MAX_SEALED: usize = 8_192;
pub const MAX_OPEN_PER_ISSUER: usize = 100;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_RESOLVE: Gas = Gas::from_tgas(8);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Invoices,
    ByIssuer,
    ByPayer,
    Profiles,
    Claimable,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Split {
    pub account_id: AccountId,
    /// Share in basis points (1/100 of a percent). The shares of one invoice add up to 10,000.
    pub bps: u16,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Open,
    Paid,
    Cancelled,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Invoice {
    pub id: u64,
    pub issuer: AccountId,
    pub token: AccountId,
    pub amount: U128,
    pub due_ms: u64,
    pub splits: Vec<Split>,
    pub status: Status,
    /// Base64 ciphertext of the invoice details (AES-GCM, key never leaves the link).
    pub sealed: String,
    /// SHA-256 (hex) of the plaintext details, so a decrypted copy can be checked against the chain.
    pub digest: String,
    pub created_ms: u64,
    pub payer: Option<AccountId>,
    pub paid_ms: Option<u64>,
    pub closed_ms: Option<u64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Profile {
    /// Public display name for the business (optional).
    pub name: String,
    /// Split used when an invoice does not set its own. Empty means 100% to the issuer.
    pub default_splits: Vec<Split>,
    /// Kill switch: while paused, no new invoices, and payments to open invoices are returned.
    pub paused: bool,
    /// Largest invoice this business accepts, in token units. 0 means no limit.
    pub max_invoice: U128,
}

#[near(serializers = [json])]
pub struct Stats {
    pub invoices: u64,
    pub open: u64,
    pub paid: u64,
    pub cancelled: u64,
    pub refunded: u64,
    pub volume_paid: U128,
}

#[near(serializers = [json])]
#[serde(rename_all = "lowercase")]
enum Msg {
    Pay(u64),
    Refund(u64),
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Invoices {
    tokens: Vec<AccountId>,
    invoices: Vector<Invoice>,
    by_issuer: LookupMap<AccountId, Vec<u64>>,
    by_payer: LookupMap<AccountId, Vec<u64>>,
    profiles: LookupMap<AccountId, Profile>,
    /// "account:token" -> amount that could not be delivered and waits for `claim`.
    claimable: LookupMap<String, u128>,
    open: u64,
    paid: u64,
    cancelled: u64,
    refunded: u64,
    volume_paid: u128,
}

fn emit(event: &str, data: String) {
    env::log_str(&format!(r#"EVENT_JSON:{{"standard":"nearvoice","version":"1.0.0","event":"{event}","data":[{data}]}}"#));
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Validates a split list against its issuer. Empty means 100% to the issuer.
pub fn normalize_splits(issuer: &AccountId, splits: Vec<Split>) -> Vec<Split> {
    if splits.is_empty() {
        return vec![Split { account_id: issuer.clone(), bps: BPS as u16 }];
    }
    require!(splits.len() <= MAX_SPLITS, "at most 5 recipients per invoice");
    require!(splits.iter().all(|s| s.bps > 0), "every recipient needs a share above 0");
    let total: u128 = splits.iter().map(|s| s.bps as u128).sum();
    require!(total == BPS, "shares must add up to 100% (10,000 basis points)");
    for (i, s) in splits.iter().enumerate() {
        require!(!splits[..i].iter().any(|t| t.account_id == s.account_id), "a recipient appears twice");
    }
    splits
}

/// How `amount` is divided between `splits`, rounding down; the remainder goes to the first recipient.
pub fn split_amounts(amount: u128, splits: &[Split]) -> Vec<u128> {
    let mut parts: Vec<u128> = splits.iter().map(|s| amount * s.bps as u128 / BPS).collect();
    let rest = amount - parts.iter().sum::<u128>();
    if let Some(first) = parts.first_mut() {
        *first += rest;
    }
    parts
}

#[near]
impl Invoices {
    #[init]
    pub fn new(tokens: Vec<AccountId>) -> Self {
        require!(!tokens.is_empty(), "accept at least one token");
        Self {
            tokens,
            invoices: Vector::new(Key::Invoices),
            by_issuer: LookupMap::new(Key::ByIssuer),
            by_payer: LookupMap::new(Key::ByPayer),
            profiles: LookupMap::new(Key::Profiles),
            claimable: LookupMap::new(Key::Claimable),
            open: 0,
            paid: 0,
            cancelled: 0,
            refunded: 0,
            volume_paid: 0,
        }
    }

    // ---------- issuers ----------

    /// Creates an invoice. Works through a meta-transaction relayer, so the issuer needs no NEAR.
    pub fn create_invoice(&mut self, token: AccountId, amount: U128, due_ms: u64, splits: Option<Vec<Split>>, sealed: String, digest: String) -> u64 {
        let issuer = env::predecessor_account_id();
        let profile = self.profiles.get(&issuer).cloned().unwrap_or_default();
        require!(!profile.paused, "this business has paused invoicing");
        require!(self.tokens.contains(&token), "this token is not accepted");
        require!(amount.0 > 0, "the amount must be above 0");
        require!(profile.max_invoice.0 == 0 || amount.0 <= profile.max_invoice.0, "above this business's invoice limit");
        require!(due_ms > env::block_timestamp_ms(), "the due date must be in the future");
        require!(!sealed.is_empty() && sealed.len() <= MAX_SEALED, "sealed details must be 1 to 8,192 characters");
        require!(is_sha256_hex(&digest), "digest must be 64 lowercase hex characters");
        let mine = self.by_issuer.get(&issuer).cloned().unwrap_or_default();
        let open = mine.iter().filter(|i| self.invoices.get(**i as u32).map(|x| x.status == Status::Open).unwrap_or(false)).count();
        require!(open < MAX_OPEN_PER_ISSUER, "too many open invoices: settle or cancel some first");

        let splits = normalize_splits(&issuer, splits.unwrap_or(profile.default_splits));
        let id = self.invoices.len() as u64;
        let inv = Invoice {
            id,
            issuer: issuer.clone(),
            token,
            amount,
            due_ms,
            splits,
            status: Status::Open,
            sealed,
            digest,
            created_ms: env::block_timestamp_ms(),
            payer: None,
            paid_ms: None,
            closed_ms: None,
        };
        emit(
            "invoice_created",
            format!(r#"{{"id":{id},"issuer":"{issuer}","token":"{}","amount":"{}","due_ms":{due_ms},"digest":"{}"}}"#, inv.token, amount.0, inv.digest),
        );
        self.invoices.push(inv);
        let mut list = mine;
        list.push(id);
        self.by_issuer.insert(issuer, list);
        self.open += 1;
        id
    }

    pub fn cancel_invoice(&mut self, id: u64) {
        let mut inv = self.get_invoice(id).unwrap_or_else(|| env::panic_str("no such invoice"));
        require!(inv.issuer == env::predecessor_account_id(), "only the issuer can cancel");
        require!(inv.status == Status::Open, "only an open invoice can be cancelled");
        inv.status = Status::Cancelled;
        inv.closed_ms = Some(env::block_timestamp_ms());
        self.invoices.set(id as u32, inv);
        self.open -= 1;
        self.cancelled += 1;
        emit("invoice_cancelled", format!(r#"{{"id":{id}}}"#));
    }

    /// Business settings: display name, default split, kill switch, invoice size limit.
    pub fn set_profile(&mut self, name: String, default_splits: Vec<Split>, paused: bool, max_invoice: U128) -> Profile {
        let who = env::predecessor_account_id();
        require!(name.chars().count() <= 64, "name is limited to 64 characters");
        let default_splits = if default_splits.is_empty() { vec![] } else { normalize_splits(&who, default_splits) };
        let p = Profile { name, default_splits, paused, max_invoice };
        self.profiles.insert(who.clone(), p.clone());
        emit("profile_set", format!(r#"{{"account_id":"{who}","paused":{paused}}}"#));
        p
    }

    /// Collects amounts that could not be delivered during a split.
    pub fn claim(&mut self, token: AccountId) -> Promise {
        let who = env::predecessor_account_id();
        let key = format!("{who}:{token}");
        let amount = self.claimable.remove(&key).unwrap_or(0);
        require!(amount > 0, "nothing to claim");
        let token_for_cb = token.clone();
        ext_ft::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(who.clone(), U128(amount), Some("nearvoice claim".into()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_RESOLVE).on_payout(who, token_for_cb, U128(amount), u64::MAX))
    }

    // ---------- money in ----------

    /// NEP-141 receiver. `msg` is `{"pay": id}` or `{"refund": id}`. Returns what is not used.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let parsed: Msg = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str(r#"msg must be {"pay": id} or {"refund": id}"#));
        match parsed {
            Msg::Pay(id) => self.pay(token, sender_id, amount.0, id),
            Msg::Refund(id) => self.refund(token, sender_id, amount.0, id),
        }
    }

    fn pay(&mut self, token: AccountId, payer: AccountId, amount: u128, id: u64) -> PromiseOrValue<U128> {
        let mut inv = self.get_invoice(id).unwrap_or_else(|| env::panic_str("no such invoice"));
        require!(inv.token == token, "this invoice is billed in another token");
        require!(inv.status == Status::Open, "this invoice is not open");
        let paused = self.profiles.get(&inv.issuer).map(|p| p.paused).unwrap_or(false);
        require!(!paused, "this business has paused invoicing");
        require!(amount >= inv.amount.0, "the payment is less than the invoice amount");
        let due = inv.amount.0;
        inv.status = Status::Paid;
        inv.payer = Some(payer.clone());
        inv.paid_ms = Some(env::block_timestamp_ms());
        let splits = inv.splits.clone();
        self.invoices.set(id as u32, inv);
        let mut mine = self.by_payer.get(&payer).cloned().unwrap_or_default();
        mine.push(id);
        self.by_payer.insert(payer.clone(), mine);
        self.open -= 1;
        self.paid += 1;
        self.volume_paid += due;
        emit("invoice_paid", format!(r#"{{"id":{id},"payer":"{payer}","token":"{token}","amount":"{due}"}}"#));

        for (s, part) in splits.iter().zip(split_amounts(due, &splits)) {
            if part == 0 {
                continue;
            }
            ext_ft::ext(token.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(s.account_id.clone(), U128(part), Some(format!("nearvoice invoice {id}")))
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_RESOLVE).on_payout(s.account_id.clone(), token.clone(), U128(part), id))
                .detach();
        }
        // Anything above the invoice amount goes back to the payer through the standard resolver.
        PromiseOrValue::Value(U128(amount - due))
    }

    fn refund(&mut self, token: AccountId, sender: AccountId, amount: u128, id: u64) -> PromiseOrValue<U128> {
        let mut inv = self.get_invoice(id).unwrap_or_else(|| env::panic_str("no such invoice"));
        require!(inv.token == token, "this invoice is billed in another token");
        require!(inv.issuer == sender, "only the issuer can refund");
        require!(inv.status == Status::Paid, "only a paid invoice can be refunded");
        require!(amount >= inv.amount.0, "a refund returns the full invoice amount");
        let payer = inv.payer.clone().unwrap_or_else(|| env::panic_str("paid invoice without payer"));
        let due = inv.amount.0;
        inv.status = Status::Refunded;
        inv.closed_ms = Some(env::block_timestamp_ms());
        self.invoices.set(id as u32, inv);
        self.paid -= 1;
        self.refunded += 1;
        self.volume_paid -= due;
        emit("invoice_refunded", format!(r#"{{"id":{id},"payer":"{payer}","amount":"{due}"}}"#));
        ext_ft::ext(token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(payer.clone(), U128(due), Some(format!("nearvoice refund {id}")))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_RESOLVE).on_payout(payer, token, U128(due), id))
            .detach();
        PromiseOrValue::Value(U128(amount - due))
    }

    /// If a transfer out failed, keep the amount claimable instead of losing it.
    #[private]
    pub fn on_payout(&mut self, receiver: AccountId, token: AccountId, amount: U128, id: u64) -> bool {
        // ft_transfer returns nothing, so a short bound is enough; an error means the transfer failed.
        let ok = env::promise_result_checked(0, 64).is_ok();
        if !ok {
            let key = format!("{receiver}:{token}");
            let before = self.claimable.get(&key).copied().unwrap_or(0);
            self.claimable.insert(key, before + amount.0);
            emit("payout_held", format!(r#"{{"id":{id},"receiver":"{receiver}","amount":"{}"}}"#, amount.0));
        }
        ok
    }

    // ---------- views ----------

    pub fn get_invoice(&self, id: u64) -> Option<Invoice> {
        if id >= self.invoices.len() as u64 {
            return None;
        }
        self.invoices.get(id as u32).cloned()
    }

    /// Newest first.
    pub fn list_by_issuer(&self, account_id: AccountId, from: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        self.list(self.by_issuer.get(&account_id), from, limit)
    }

    /// Newest first.
    pub fn list_by_payer(&self, account_id: AccountId, from: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        self.list(self.by_payer.get(&account_id), from, limit)
    }

    /// Newest first, across everyone (public fields only; details stay sealed).
    pub fn list_recent(&self, limit: Option<u32>) -> Vec<Invoice> {
        let n = self.invoices.len() as u64;
        let limit = limit.unwrap_or(20).min(50) as u64;
        (n.saturating_sub(limit)..n).rev().filter_map(|i| self.get_invoice(i)).collect()
    }

    pub fn get_profile(&self, account_id: AccountId) -> Profile {
        self.profiles.get(&account_id).cloned().unwrap_or_default()
    }

    pub fn get_claimable(&self, account_id: AccountId, token: AccountId) -> U128 {
        U128(self.claimable.get(&format!("{account_id}:{token}")).copied().unwrap_or(0))
    }

    pub fn accepted_tokens(&self) -> &Vec<AccountId> {
        &self.tokens
    }

    pub fn stats(&self) -> Stats {
        Stats {
            invoices: self.invoices.len() as u64,
            open: self.open,
            paid: self.paid,
            cancelled: self.cancelled,
            refunded: self.refunded,
            volume_paid: U128(self.volume_paid),
        }
    }

    fn list(&self, ids: Option<&Vec<u64>>, from: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        let Some(ids) = ids else { return vec![] };
        ids.iter()
            .rev()
            .skip(from.unwrap_or(0) as usize)
            .take(limit.unwrap_or(20).min(50) as usize)
            .filter_map(|i| self.get_invoice(*i))
            .collect()
    }
}

#[cfg(test)]
mod tests;
