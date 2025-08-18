type ThemeToggleProps = {
  value: boolean;
  onChange: (next: boolean) => void;
  className?: string; // added to allow external styling
};

export default function ThemeToggle({
  value,
  onChange,
  className = ''
}: ThemeToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={className}
    >
      {value ? '🌙 Dark Mode' : '☀️ Light Mode'}
    </button>
  );
}
