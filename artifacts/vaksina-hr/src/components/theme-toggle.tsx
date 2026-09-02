import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  className?: string;
  variant?: 'header' | 'sidebar';
};

export function ThemeToggle({ className, variant = 'header' }: Props) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (theme === 'system') {
      setTheme(resolvedTheme === 'dark' ? 'dark' : 'light');
    }
  }, [theme, resolvedTheme, setTheme]);

  if (!mounted) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('shrink-0 rounded-full', className)}
        aria-label="Mavzu"
        disabled
      >
        <Sun className="h-5 w-5 opacity-0" />
      </Button>
    );
  }

  const isDark = resolvedTheme === 'dark';

  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        'shrink-0 rounded-full',
        variant === 'header'
          ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
          : 'border-0 bg-transparent p-0 text-inherit shadow-none hover:bg-transparent hover:text-inherit',
        className,
      )}
      aria-label={isDark ? 'Kunduzgi rejim' : 'Kechki rejim'}
      title={isDark ? 'Kunduzgi rejim' : 'Kechki rejim'}
      onClick={toggleTheme}
    >
      {isDark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </Button>
  );
}
