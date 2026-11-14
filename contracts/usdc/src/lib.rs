//! Test USDC for Nearvoice (testnet only).
//!
//! A standard NEP-141 token with two testnet conveniences:
//! * `faucet()` mints up to 1,000 tUSDC to the caller, once an hour.
//! * Receivers never need a storage deposit: the token registers them on first
//!   receipt and pays the storage itself, the way most people expect money to work.
//! 6 decimals, like USDC.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

pub const UNIT: u128 = 1_000_000;
pub const FAUCET_AMOUNT: u128 = 1_000 * UNIT;
pub const FAUCET_COOLDOWN_NS: u64 = 3_600 * 1_000_000_000;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Token,
    LastFaucet,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestUsdc {
    token: FungibleToken,
    last_faucet: LookupMap<AccountId, u64>,
}

#[near]
impl TestUsdc {
    #[init]
    pub fn new() -> Self {
        let mut token = FungibleToken::new(Key::Token);
        token.internal_register_account(&env::current_account_id());
        Self { token, last_faucet: LookupMap::new(Key::LastFaucet) }
    }

    /// 1,000 test USDC to the caller, at most once an hour per account.
    pub fn faucet(&mut self) -> U128 {
        let who = env::predecessor_account_id();
        let now = env::block_timestamp();
        if let Some(last) = self.last_faucet.get(&who) {
            require!(now >= last + FAUCET_COOLDOWN_NS, "the faucet gives each account 1,000 tUSDC once an hour");
        }
        self.last_faucet.insert(who.clone(), now);
        self.ensure_registered(&who);
        self.token.internal_deposit(&who, FAUCET_AMOUNT);
        FtMint { owner_id: &who, amount: U128(FAUCET_AMOUNT), memo: Some("faucet") }.emit();
        U128(FAUCET_AMOUNT)
    }

    /// When an account may use the faucet again (ns since epoch); 0 if now.
    pub fn faucet_ready_at(&self, account_id: AccountId) -> u64 {
        self.last_faucet.get(&account_id).map(|t| t + FAUCET_COOLDOWN_NS).unwrap_or(0)
    }

    fn ensure_registered(&mut self, account_id: &AccountId) {
        if !self.token.accounts.contains_key(account_id) {
            self.token.internal_register_account(account_id);
        }
    }
}

#[near]
impl FungibleTokenCore for TestUsdc {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.ensure_registered(&receiver_id);
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.ensure_registered(&receiver_id);
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for TestUsdc {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for TestUsdc {
    /// Registration is free here; this exists so standard wallets and apps that call it keep working.
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, _registration_only: Option<bool>) -> StorageBalance {
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        self.ensure_registered(&who);
        let refund = env::attached_deposit();
        if !refund.is_zero() {
            near_sdk::Promise::new(env::predecessor_account_id()).transfer(refund).detach();
        }
        StorageBalance { total: NearToken::from_near(0), available: NearToken::from_near(0) }
    }

    #[payable]
    fn storage_withdraw(&mut self, _amount: Option<NearToken>) -> StorageBalance {
        env::panic_str("nothing to withdraw: this token pays its own storage")
    }

    #[payable]
    fn storage_unregister(&mut self, _force: Option<bool>) -> bool {
        false
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds { min: NearToken::from_near(0), max: Some(NearToken::from_near(0)) }
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        Some(StorageBalance { total: NearToken::from_near(0), available: NearToken::from_near(0) }).filter(|_| self.token.accounts.contains_key(&account_id))
    }
}

#[near]
impl FungibleTokenMetadataProvider for TestUsdc {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Test USDC (Nearvoice)".to_string(),
            symbol: "tUSDC".to_string(),
            icon: Some("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiMyNzc1Q0EiLz48dGV4dCB4PSIxNiIgeT0iMjEiIGZvbnQtc2l6ZT0iMTQiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IiNmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPiQ8L3RleHQ+PC9zdmc+".to_string()),
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn at(who: &str, ns: u64, deposit: NearToken) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("usdc.nearvoice.testnet".parse().unwrap())
            .predecessor_account_id(who.parse().unwrap())
            .block_timestamp(ns)
            .attached_deposit(deposit)
            .build());
    }

    #[test]
    fn faucet_mints_once_an_hour() {
        at("deployer.testnet", 1, NearToken::from_near(0));
        let mut t = TestUsdc::new();
        at("alice.testnet", 10, NearToken::from_near(0));
        assert_eq!(t.faucet().0, FAUCET_AMOUNT);
        assert_eq!(t.ft_balance_of("alice.testnet".parse().unwrap()).0, FAUCET_AMOUNT);
        assert_eq!(t.faucet_ready_at("alice.testnet".parse().unwrap()), 10 + FAUCET_COOLDOWN_NS);
        at("alice.testnet", 10 + FAUCET_COOLDOWN_NS, NearToken::from_near(0));
        t.faucet();
        assert_eq!(t.ft_total_supply().0, 2 * FAUCET_AMOUNT);
    }

    #[test]
    #[should_panic(expected = "once an hour")]
    fn faucet_cooldown_holds() {
        at("deployer.testnet", 1, NearToken::from_near(0));
        let mut t = TestUsdc::new();
        at("alice.testnet", 10, NearToken::from_near(0));
        t.faucet();
        t.faucet();
    }

    #[test]
    fn receivers_need_no_storage_deposit() {
        at("deployer.testnet", 1, NearToken::from_near(0));
        let mut t = TestUsdc::new();
        at("alice.testnet", 10, NearToken::from_near(0));
        t.faucet();
        at("alice.testnet", 11, NearToken::from_yoctonear(1));
        t.ft_transfer("brand-new.testnet".parse().unwrap(), U128(5 * UNIT), None);
        assert_eq!(t.ft_balance_of("brand-new.testnet".parse().unwrap()).0, 5 * UNIT);
        assert!(t.storage_balance_of("brand-new.testnet".parse().unwrap()).is_some());
    }
}
