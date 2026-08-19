# Settlement Rail Standard Alignment

This file records the public-standard terminology used by SRA for ACH and Fedwire Funds Service settlement instructions.

## ACH Network
- Rules: Nacha Operating Rules
- File format: ACH File Format
- Fixed record length: 94 characters
- Common credit SEC codes supported by SRA: PPD and CCD
- Receiving DFI Identification: first 8 digits of the routing transit number
- Check Digit: ninth digit of the routing transit number
- DFI Account Number: receiving account number
- Amount: transaction amount
- Receiving Individual/Company Name: receiver name
- Trace Number: 15 digits, assigned by the ODFI

## Fedwire Funds Service
- Message standard: ISO 20022
- Business Application Header: head.001
- Customer Credit Transfer: pacs.008
- Financial Institution Credit Transfer: pacs.009
- Payment Return: pacs.004
- Payment Status Request: pacs.028
- Return Request: camt.056
- Return Request Response: camt.029
- Investigation Request: camt.110
- Investigation Response: camt.111
- Reconciliation reference: IMAD
