import { useTheme } from 'next-themes';

export function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return {
    isDark,
    grid: isDark ? '#334155' : '#e8edf2',
    tick: isDark ? '#94a3b8' : '#64748b',
    legend: isDark ? '#cbd5e1' : '#475569',
    area: '#10b981',
    areaFill: isDark ? 0.35 : 0.2,
    lineLate: '#f59e0b',
    lineAbsent: '#ef4444',
    barPrimary: isDark ? '#38bdf8' : '#0ea5e9',
    barSecondary: isDark ? '#a78bfa' : '#8b5cf6',
    barDist: isDark ? '#22d3ee' : '#06b6d4',
  };
}
