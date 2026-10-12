interface Props {
  title: string;
  description?: string;
  icon?: string;
}

export default function Placeholder({ title, description, icon = '🚧' }: Props) {
  return (
    <div style={{ padding: '24px' }}>
      <div className="page-title" style={{ marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#697586', marginBottom: 24 }}>{description}</div>
      <div className="card" style={{ padding: '80px', textAlign: 'center', color: '#697586' }}>
        <div style={{ fontSize: 48, marginBottom: 14 }}>{icon}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1A1F36', marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13.5 }}>This module is ready to be built. Core screens are live — navigate using the sidebar.</div>
      </div>
    </div>
  );
}
