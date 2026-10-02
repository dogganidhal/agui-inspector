// F06 T054: one page that renders every primitive and state. The Playwright theme spec bundles and
// serves it; it is test support, never part of the shipped app. Sections are addressed by
// data-section so the spec can find a primitive without styling hooks of its own.
import { useState, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CodeBlock,
  Dialog,
  Editor,
  FamilyDot,
  Field,
  FilterChip,
  Finding,
  Icon,
  Label,
  Popover,
  SearchField,
  SegmentedControl,
  Switch,
  Tag,
  ToastRegion,
  icons,
  useToasts,
  type Family,
  type IconName,
  type TagVariant,
} from '../../src/views/theme/index';

const frame = '{\n  "type": "TOOL_CALL_ARGS",\n  "toolCallId": "call_1",\n  "delta": "{\\"city\\": \\"Paris\\", \\"days\\": 3, \\"metric\\": true, \\"note\\": null}"\n}';
const families: Family[] = ['text', 'tool', 'reason', 'state', 'activity', 'neutral'];
const tags: TagVariant[] = ['neutral', 'line', 'dashed', 'accent', 'ok', 'warn', 'err'];

const Section = ({ name, children }: { name: string; children: ReactNode }): ReactElement => (
  <section data-section={name} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid currentColor' }}>
    <Label>{name}</Label>
    {children}
  </section>
);

function Fixture(): ReactElement {
  const [mode, setMode] = useState('full');
  const [view, setView] = useState('conversation');
  const [render, setRender] = useState(true);
  const [dialog, setDialog] = useState(false);
  const { toasts, toast } = useToasts();
  return (
    <main style={{ background: 'var(--bg)', color: 'var(--fg)', font: `400 13px/1.5 var(--agui-font-sans)`, padding: 16, minHeight: '100vh' }}>
      <Section name="button">
        <Button>Default</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button small>Small</Button>
        <Button variant="primary" iconOnly aria-label="Send"><Icon name="send" /></Button>
        <Button variant="ghost" iconOnly small aria-label="Copy"><Icon name="copy" size={14} /></Button>
        <Button disabled>Disabled</Button>
        <Button variant="primary" disabled>Disabled primary</Button>
      </Section>
      <Section name="tag">
        {tags.map((variant) => <Tag key={variant} variant={variant}>{variant}</Tag>)}
        <Tag variant="accent" pulse>streaming</Tag>
      </Section>
      <Section name="family-dot">
        {families.map((family) => <FamilyDot key={family} family={family} />)}
        {families.map((family) => <FamilyDot key={`h-${family}`} family={family} hollow />)}
      </Section>
      <Section name="chip">
        <FilterChip pressed={false}>Default</FilterChip>
        <FilterChip pressed>Pressed</FilterChip>
        <FilterChip pressed={false} disabled>Disabled</FilterChip>
        <FilterChip pressed={false} family="text" count={12}>Text</FilterChip>
        <FilterChip pressed family="tool" count={3}>Tool</FilterChip>
      </Section>
      <Section name="card">
        <Card>
          <CardHeader><Tag variant="line">get_open_returns</Tag><Tag>client tool</Tag></CardHeader>
          <CardBody><Field aria-label="Customer" defaultValue="cus_42" /></CardBody>
          <CardFooter>Answered by you</CardFooter>
        </Card>
        <Card interrupt>
          <CardHeader><Tag variant="accent">Interrupt</Tag>1 of 2 waiting</CardHeader>
          <CardBody>Approve the refund?</CardBody>
          <CardFooter>The next run carries resume once every interrupt has an answer.</CardFooter>
        </Card>
      </Section>
      <Section name="code-block">
        <CodeBlock text={frame} aria-label="Frame as JSON" />
        <CodeBlock format="raw" text={'event: message\ndata: not json at all'} aria-label="Frame as received" />
      </Section>
      <Section name="segmented">
        <SegmentedControl label="Message mode" value={mode} onChange={setMode} options={[{ value: 'full', label: 'Full transcript' }, { value: 'turn', label: 'Turn only' }]} />
        <SegmentedControl label="View" value={view} onChange={setView} options={[{ value: 'conversation', label: 'Conversation' }, { value: 'inspection', label: 'Inspection' }, { value: 'agent', label: 'Agent' }]} />
      </Section>
      <Section name="switch">
        <Switch aria-label="Render A2UI" checked={render} onChange={setRender} />
        <Switch aria-label="Inject render tool" checked={false} onChange={() => {}} />
        <Switch aria-label="Locked" checked disabled onChange={() => {}} />
      </Section>
      <Section name="field">
        <Field aria-label="Header name" defaultValue="Authorization" />
        <Field aria-label="Header with error" defaultValue="bad" invalid />
        <SearchField aria-label="Filter frames" placeholder="Filter frames by type or content" />
        <Editor aria-label="Payload" defaultValue={'{\n  "approved": true\n}'} />
        <Editor aria-label="Payload with error" defaultValue="{" invalid />
      </Section>
      <Section name="finding">
        <Finding kind="Note">Client-derived from TEXT_MESSAGE_CHUNK. Not on the wire.</Finding>
        <Finding variant="warn" kind="Run input">messages[0].role: expected user or assistant.</Finding>
        <Finding variant="err" kind="Schema">type is required. Capture continued.</Finding>
      </Section>
      <Section name="popover">
        <Button popoverTarget="fixture-pop">Open popover</Button>
        <Popover id="fixture-pop" aria-label="Agent picker">
          <Label>Configured agents</Label>
          <p style={{ margin: 0 }}>Support assistant</p>
        </Popover>
      </Section>
      <Section name="dialog">
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Export this session?"
          footer={<><Button onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary" onClick={() => setDialog(false)}>Export session</Button></>}
        >
          <p>Raw frames can contain personal or sensitive data. Headers and tokens are never included.</p>
        </Dialog>
      </Section>
      <Section name="toast">
        <Button onClick={() => toast('Token cleared.')}>Show toast</Button>
      </Section>
      <Section name="icon">
        {(Object.keys(icons) as IconName[]).map((name) => <Icon key={name} name={name} size={20} />)}
      </Section>
      <Section name="motion">
        <span className="agui-caret">Streaming text</span>
        <span className="agui-fresh">New row</span>
      </Section>
      <ToastRegion toasts={toasts} />
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<Fixture />);
