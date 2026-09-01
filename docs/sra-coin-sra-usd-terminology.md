# SRA Coin, SRA/USD Market, and Native SRA/USD Account Value

- **Asset name:** SRA Coin
- **Asset symbol:** SRA
- **Native market pair:** SRA/USD
- **Platform par reference:** 1 SRA = 1 USD

Within the instrument-representation market, SRA/USD continues to name the
market pair and does not rename an existing SRA Coin Position.

Within a Direct Value Account, **SRA/USD** also names the canonical native
settlement value delivered by an authorized funding transaction. The account
asset uses canonical ID `SRA-USD` and public-rail symbol `SRAUSD`. It is not a
second name for an instrument-specific SRA Coin Position: the instrument is the
source authorization and obligation; native SRA/USD is the fungible usable
account value delivered under it.

The asset registry must preserve that distinction:

- `COIN_POSITION`: instrument-specific representation and lineage;
- `SRA-USD`: native fungible Direct Value Account position;
- `SRAUSD + rail identifier`: registered public-rail representation of the
  canonical native position.
