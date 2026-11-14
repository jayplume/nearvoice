use super::*;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::testing_env;

const USDC: &str = "usdc.nearvoice.testnet";
const D: &str = "0000000000000000000000000000000000000000000000000000000000000abc";
const DAY_MS: u64 = 86_400_000;

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn at(who: &str, ms: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acct("invoices.nearvoice.testnet"))
        .predecessor_account_id(acct(who))
        .block_timestamp(ms * 1_000_000)
        .build());
}

fn contract() -> Invoices {
    at("deployer.testnet", 1_000);
    Invoices::new(vec![acct(USDC)])
}

fn split(a: &str, bps: u16) -> Split {
    Split { account_id: acct(a), bps }
}

fn invoice(c: &mut Invoices, who: &str, amount: u128, splits: Option<Vec<Split>>) -> u64 {
    at(who, 2_000);
    c.create_invoice(acct(USDC), U128(amount), 2_000 + 30 * DAY_MS, splits, "c2VhbGVk".into(), D.into())
}

fn pay(c: &mut Invoices, payer: &str, amount: u128, id: u64) -> u128 {
    at(USDC, 3_000);
    match c.ft_on_transfer(acct(payer), U128(amount), format!(r#"{{"pay":{id}}}"#)) {
        PromiseOrValue::Value(v) => v.0,
        PromiseOrValue::Promise(_) => panic!("expected a value"),
    }
}

#[test]
fn split_amounts_add_up_exactly() {
    let s = vec![split("a.testnet", 8_000), split("tax.testnet", 1_500), split("b.testnet", 500)];
    assert_eq!(split_amounts(250_000_000, &s), vec![200_000_000, 37_500_000, 12_500_000]);
    // Rounding dust goes to the first recipient, never lost.
    let parts = split_amounts(1_000_001, &[split("a.testnet", 3_333), split("b.testnet", 3_333), split("c.testnet", 3_334)]);
    assert_eq!(parts.iter().sum::<u128>(), 1_000_001);
}

#[test]
fn an_invoice_is_created_open_with_the_issuer_taking_everything_by_default() {
    let mut c = contract();
    let id = invoice(&mut c, "alice.testnet", 250_000_000, None);
    let inv = c.get_invoice(id).unwrap();
    assert_eq!((inv.status, inv.splits.len(), inv.splits[0].bps), (Status::Open, 1, 10_000));
    assert_eq!(c.stats().open, 1);
    assert!(get_logs().iter().any(|l| l.contains(r#""event":"invoice_created""#)));
}

#[test]
fn paying_settles_splits_and_returns_any_excess() {
    let mut c = contract();
    let id = invoice(&mut c, "alice.testnet", 100_000_000, Some(vec![split("alice.testnet", 8_500), split("tax.testnet", 1_500)]));
    let returned = pay(&mut c, "client.testnet", 100_000_005, id);
    assert_eq!(returned, 5, "the extra 5 units go back to the payer");
    let inv = c.get_invoice(id).unwrap();
    assert_eq!(inv.status, Status::Paid);
    assert_eq!(inv.payer, Some(acct("client.testnet")));
    assert_eq!(c.list_by_payer(acct("client.testnet"), None, None).len(), 1);
    let s = c.stats();
    assert_eq!((s.open, s.paid, s.volume_paid.0), (0, 1, 100_000_000));
    // One transfer per recipient, to the token contract.
    let r = get_created_receipts();
    assert!(r.iter().filter(|x| x.receiver_id == acct(USDC)).count() >= 2);
}

#[test]
#[should_panic(expected = "less than the invoice amount")]
fn underpaying_is_refused() {
    let mut c = contract();
    let id = invoice(&mut c, "alice.testnet", 100, None);
    pay(&mut c, "client.testnet", 99, id);
}

#[test]
#[should_panic(expected = "this invoice is not open")]
fn an_invoice_cannot_be_paid_twice() {
    let mut c = contract();
    let id = invoice(&mut c, "alice.testnet", 100, None);
    pay(&mut c, "client.testnet", 100, id);
    pay(&mut c, "client.testnet", 100, id);
}

#[test]
#[should_panic(expected = "billed in another token")]
fn only_the_invoice_token_pays_it() {
    let mut c = contract();
    let id = invoice(&mut c, "alice.testnet", 100, None);
    at("fake-usdc.testnet", 3_000);
    let _ = c.ft_on_transfer(acct("client.testnet"), U128(100), format!(r#"{{"pay":{id}}}"#));
}

#[test]
fn the_issuer_can_refund_a_paid_invoice() {
    let mut c = contract();
    let id = invoice(&mut c, "alice.testnet", 100, None);
    pay(&mut c, "client.testnet", 100, id);
    at(USDC, 4_000);
    let _ = c.ft_on_transfer(acct("alice.testnet"), U128(100), format!(r#"{{"refund":{id}}}"#));
    let inv = c.get_invoice(id).unwrap();
    assert_eq!(inv.status, Status::Refunded);
    assert_eq!((c.stats().paid, c.stats().refunded, c.stats().volume_paid.0), (0, 1, 0));
}

#[test]
#[should_panic(expected = "only the issuer can refund")]
fn nobody_else_can_refund() {
    let mut c = contract();
    let id = invoice(&mut c, "alice.testnet", 100, None);
    pay(&mut c, "client.testnet", 100, id);
    at(USDC, 4_000);
    let _ = c.ft_on_transfer(acct("mallory.testnet"), U128(100), format!(r#"{{"refund":{id}}}"#));
}

#[test]
fn cancelling_closes_an_open_invoice() {
    let mut c = contract();
    let id = invoice(&mut c, "alice.testnet", 100, None);
    at("alice.testnet", 3_000);
    c.cancel_invoice(id);
    assert_eq!(c.get_invoice(id).unwrap().status, Status::Cancelled);
    assert_eq!((c.stats().open, c.stats().cancelled), (0, 1));
}

#[test]
#[should_panic(expected = "only the issuer can cancel")]
fn only_the_issuer_cancels() {
    let mut c = contract();
    let id = invoice(&mut c, "alice.testnet", 100, None);
    at("mallory.testnet", 3_000);
    c.cancel_invoice(id);
}

#[test]
fn the_profile_split_is_the_default_and_the_kill_switch_stops_new_invoices() {
    let mut c = contract();
    at("alice.testnet", 1_500);
    c.set_profile("Alice Studio".into(), vec![split("alice.testnet", 9_000), split("tax.testnet", 1_000)], false, U128(0));
    let id = invoice(&mut c, "alice.testnet", 100, None);
    assert_eq!(c.get_invoice(id).unwrap().splits.len(), 2);
    at("alice.testnet", 1_600);
    c.set_profile("Alice Studio".into(), vec![], true, U128(0));
    assert!(c.get_profile(acct("alice.testnet")).paused);
}

#[test]
#[should_panic(expected = "this business has paused invoicing")]
fn a_paused_business_cannot_be_paid() {
    let mut c = contract();
    let id = invoice(&mut c, "alice.testnet", 100, None);
    at("alice.testnet", 2_500);
    c.set_profile(String::new(), vec![], true, U128(0));
    pay(&mut c, "client.testnet", 100, id);
}

#[test]
#[should_panic(expected = "shares must add up to 100%")]
fn splits_must_add_up() {
    let mut c = contract();
    invoice(&mut c, "alice.testnet", 100, Some(vec![split("alice.testnet", 9_000)]));
}

#[test]
#[should_panic(expected = "a recipient appears twice")]
fn splits_cannot_repeat_a_recipient() {
    let mut c = contract();
    invoice(&mut c, "alice.testnet", 100, Some(vec![split("alice.testnet", 5_000), split("alice.testnet", 5_000)]));
}

#[test]
#[should_panic(expected = "above this business's invoice limit")]
fn the_invoice_limit_holds() {
    let mut c = contract();
    at("alice.testnet", 1_500);
    c.set_profile(String::new(), vec![], false, U128(1_000));
    invoice(&mut c, "alice.testnet", 1_001, None);
}

#[test]
#[should_panic(expected = "digest must be 64 lowercase hex characters")]
fn the_digest_is_checked() {
    let mut c = contract();
    at("alice.testnet", 2_000);
    c.create_invoice(acct(USDC), U128(1), 2_000 + DAY_MS, None, "x".into(), "nope".into());
}

#[test]
fn lists_are_newest_first() {
    let mut c = contract();
    for _ in 0..3 {
        invoice(&mut c, "alice.testnet", 100, None);
    }
    let ids: Vec<u64> = c.list_by_issuer(acct("alice.testnet"), None, None).iter().map(|i| i.id).collect();
    assert_eq!(ids, vec![2, 1, 0]);
    assert_eq!(c.list_recent(Some(2)).len(), 2);
}
