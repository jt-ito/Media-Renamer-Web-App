import ScanManager from './ScanManager';

export default function Dashboard(props: { buttons: { base: string } }) {
  // Thin wrapper for backwards compatibility while we incrementally extract hooks/components.
  return <ScanManager {...props} />;
}
