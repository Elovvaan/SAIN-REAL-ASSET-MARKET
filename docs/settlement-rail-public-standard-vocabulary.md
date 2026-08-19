# SRA Settlement Rail Public-Standard Vocabulary

This document locks the admin settlement language to the current public terminology used by Nacha for ACH and Federal Reserve Financial Services for the Fedwire Funds Service.

## ACH Network / Nacha

Use the following public-standard terms in the SRA admin settlement flow and internal settlement instruction model where they apply:

- ACH Network
- Nacha Operating Rules
- Standard Entry Class (SEC) Code
- Company Entry Description
- Effective Entry Date
- Receiving DFI Identification
- Check Digit
- DFI Account Number
- Amount
- Receiving Individual/Company Name
- Addenda Record Indicator
- Trace Number
- Originating DFI Identification

For PPD and CCD Entry Detail Records, the Receiving DFI Identification is the first 8 digits of the receiving bank routing transit number and the Check Digit is the 9th digit. The Trace Number is assigned by the ODFI.

SRA financing disbursement remains a credit-side settlement instruction. The selected SEC Code must reflect the actual receiving-account context and originator/receiver relationship rather than being hardcoded globally.

## Fedwire Funds Service / ISO 20022

Use the following public-standard terms in the SRA admin settlement flow and internal settlement instruction model where they apply:

- Fedwire Funds Service
- ISO 20022
- Business Application Header (head.001)
- Customer Credit Transfer (pacs.008)
- Financial Institution Credit Transfer (pacs.009)
- Payment Return (pacs.004)
- Fedwire Funds Payment Status (pacs.002)
- Return Request (camt.056)
- Return Response (camt.029)
- Investigation Request (camt.110)
- Investigation Response (camt.111)
- Debtor
- Debtor Account
- Creditor
- Creditor Account
- Creditor Agent
- Remittance Information
- IMAD / Fedwire transaction reference

For a financing disbursement to a dealer, customer, seller, escrow, or other non-financial institution, the relevant Fedwire value message is a Customer Credit Transfer (pacs.008). If all parties are financial institutions, use a Financial Institution Credit Transfer (pacs.009).

## SRA Implementation Rule

The SRA financing workflow remains generic and unchanged:

financing authorization -> financing export package -> settlement instruction -> selected rail -> external institution/provider execution -> network/institution reference -> confirmation -> reconciliation.

Do not create a special vehicle workflow, special $1 workflow, provider-specific business workflow, or chain-specific settlement architecture.

ACH and Fedwire terminology in the admin settlement flow should mirror the public vocabulary above. Generic internal aliases may remain only where required for backward compatibility, but the public-standard fields should be explicit in the settlement instruction record and admin interface.
