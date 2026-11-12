// Feature 018, T015 (SC-002): the example on the docs page. A test sends the interrupt scenario, answers it, and asserts.
import { test } from 'node:test';
import { createInteractiveServer } from '../../../../examples/reference-agent/interactive-scenarios.ts';
import { assertMessage, assertNoFinding, assertPendingInterrupt, openSession } from '../../src/headless/index.ts';

test('an interrupt is answered and the agent goes on', async () => {
  const agent = await createInteractiveServer();
  const session = await openSession({ target: `${agent.origin}/agent` });

  await session.send('interrupt');
  assertPendingInterrupt(session, { reason: 'approval' });

  await session.answerInterrupt('i-approve', 'resolved', { approved: true });
  await session.answerInterrupt('i-contact', 'cancelled');
  assertMessage(session, { role: 'assistant', text: /Resumed with i-approve=resolved/ });
  assertNoFinding(session);

  session.close();
  await agent.close();
});
