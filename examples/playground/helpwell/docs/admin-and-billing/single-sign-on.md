---
title: Single sign-on with SAML
description: Connect Okta, Entra ID, Google Workspace or any SAML 2.0 provider, and decide how strict to make it.
order: 1
appliesTo: Business plan
---

# Single sign-on with SAML

Ridgeline speaks SAML 2.0, SP-initiated. Set it up at **Settings → Security →
Single sign-on**. You need the Admin role and access to your identity provider.

## What to give your identity provider

| Field | Value |
| --- | --- |
| ACS / Reply URL | `https://app.ridgeline.app/auth/saml/callback` |
| Entity ID / Audience | `https://app.ridgeline.app/auth/saml/metadata` |
| Name ID format | `EmailAddress` |
| Signature | Assertions signed, SHA-256 |

Then paste your provider's metadata URL — or the XML itself — into Ridgeline and
save. The connection is **off** until you test it, so saving cannot lock anybody
out.

## Attributes we read

`email` is required and must be the person's real work address, because it is
the key Ridgeline matches on. `firstName`, `lastName` and `groups` are optional.

If you send `groups`, you can map a group to a Ridgeline role at **Settings →
Security → Role mapping**. Somebody in a mapped group gets that role on every
sign-in, and their role can no longer be changed by hand — the directory wins.

## Just-in-time provisioning

With JIT on, somebody who authenticates successfully and has no Ridgeline
account gets a Member account created on the spot. With it off, they get a
"no account" message and somebody has to invite them first.

JIT on is the reason to do SSO at all. JIT off is the right answer if your
directory contains people who should not have an expense tool.

## Enforcing it

Once the test passes, **Require SSO** turns off password sign-in for everybody
on your verified domains. Two exceptions survive on purpose:

- **Break-glass admins.** Name up to two at **Settings → Security → Break-glass**.
  They keep password sign-in so a broken IdP is not a locked-out workspace. Their
  sign-ins are always logged and always emailed to all Admins.
- **Guests on other domains.** Your external accountant is not in your directory.
  They keep password sign-in unless you remove them.

## SCIM

SCIM 2.0 provisioning and deprovisioning is available on the Business plan at
**Settings → Security → SCIM**. Deprovisioning through SCIM deactivates rather
than deletes, for the reason described in
[Invite your team and set roles](/help/getting-started/invite-your-team).

## When sign-in fails

The error page carries a short code. The three you will actually see:

- **`saml_audience_mismatch`** — the Entity ID in your IdP does not match the one
  above, usually a trailing slash.
- **`saml_no_email`** — the assertion did not carry an `email` attribute.
- **`saml_clock_skew`** — your IdP's clock is more than five minutes out.
