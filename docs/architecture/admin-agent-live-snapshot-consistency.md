# Administrative Agent Live Snapshot Consistency

The private SRA administration dashboard and the Administrative Intelligence Agent both read the same `PersistentDomainService` instance. A displayed mismatch can occur when an earlier agent response remains visible after the dashboard metrics are refreshed by later ingestion or a governed platform operation.

The consistency rule is:

1. Refresh the dashboard summary immediately before an administrative agent question.
2. Generate the agent answer from the current domain snapshot.
3. Return a snapshot timestamp and the exact metric counts used by the answer.
4. Refresh the dashboard summary immediately after the answer.
5. Display the answer's snapshot timestamp so historical chat responses are not presented as current live state.

This preserves the chat history while making its temporal boundary explicit.