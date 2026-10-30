import { orderTimeline } from './orderTimelineModel';
import { StatusBadge } from './StatusBadge';

export function OrderTimeline({ status, paymentStatus, createdAt, paymentConfirmedAt }: { status: string; paymentStatus?: string | null; createdAt?: string; paymentConfirmedAt?: string | null }) {
  const steps = orderTimeline(status, paymentStatus);
  return <ol className="order-timeline" aria-label="Order progress">
    {steps.map((step, index) => <li className={`timeline-step is-${step.state}`} key={`${step.status}-${index}`}>
      <span className="timeline-connector" aria-hidden="true" />
      <StatusBadge status={step.status} label={step.label} />
      {(step.status === 'pending' ? createdAt : step.status === 'paid' ? paymentConfirmedAt : null) && <time dateTime={step.status === 'pending' ? createdAt : paymentConfirmedAt || undefined}>{new Date(step.status === 'pending' ? createdAt! : paymentConfirmedAt!).toLocaleString('id-ID')}</time>}
    </li>)}
  </ol>;
}
