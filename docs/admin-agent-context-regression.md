# Connector Inference Regression

An earlier administrative response incorrectly concluded that Coinbase was not connected because treasury wallet, Coin Position, and SRA Transaction counts were zero.

The correction preserves the private administration summary in the agent request and locks the following rule:

> A public market-data connector is evaluated from its own connector status. Zero treasury, settlement, Coin Position, or transaction records do not establish that the connector is absent.
