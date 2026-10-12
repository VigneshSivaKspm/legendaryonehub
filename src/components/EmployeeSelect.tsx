import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Employee } from '../db/database';

interface Props {
  /** Selected employee name (tasks, deliverables and projects store the name) */
  value: string;
  onChange: (name: string, employee?: Employee) => void;
  /** Only list employees matching this filter (e.g. project managers) */
  filter?: (employee: Employee) => boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  includeInactive?: boolean;
}

/**
 * Dropdown of real employees from the Employees module (Firestore → Dexie cache).
 * A saved value that no longer matches an employee is kept as an extra option so
 * editing an old record never silently drops its assignee.
 */
export default function EmployeeSelect({
  value,
  onChange,
  filter,
  placeholder = 'Select Employee',
  className = 'select-base',
  style,
  includeInactive = false,
}: Props) {
  const employees = useLiveQuery(() => db.employees.toArray(), []) || [];

  const options = employees
    .filter((e) => includeInactive || e.status !== 'Inactive')
    .filter((e) => !filter || filter(e))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const hasLegacyValue = !!value && !options.some((e) => e.name === value);

  return (
    <select
      className={className}
      style={{ width: '100%', ...style }}
      value={value}
      onChange={(e) => {
        const name = e.target.value;
        onChange(name, options.find((emp) => emp.name === name));
      }}
    >
      <option value="">{options.length === 0 ? 'No employees found' : placeholder}</option>
      {hasLegacyValue && <option value={value}>{value}</option>}
      {options.map((emp) => (
        <option key={emp.id} value={emp.name}>
          {emp.name}
          {emp.employeeId ? ` (${emp.employeeId})` : ''}
        </option>
      ))}
    </select>
  );
}

/**
 * Who can be picked as a project manager: the Project Manager or Admin access role,
 * the Management department, or a job title containing "manager".
 */
export function canManageProjects(e: Employee): boolean {
  return (
    e.accessRole === 'Project Manager' ||
    e.accessRole === 'Admin' ||
    (e.dept || '').toLowerCase() === 'management' ||
    /manager/i.test(e.role || '')
  );
}
