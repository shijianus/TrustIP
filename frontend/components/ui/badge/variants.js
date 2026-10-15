import { cva } from 'class-variance-authority';

// Badge 本身是展示元素，默认不应响应 hover（shadcn 原版 variants 里写了 hover:bg-*/80，
// 那是为"Badge 被包进 <a> / <button>"预留的，裸用时反而是 bug）。这里移除。
// 需要 interactive 效果的场景，在外层 <a class="hover:..."> 控制。
export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
        outline: 'text-foreground',
        success: 'border-transparent bg-success text-success-foreground shadow',
        // Soft status tints — the -soft / -soft-fg pairs clear 4.5:1 in both
        // themes. Pair with an icon (or use ui/status-pill) so the state is
        // never carried by colour alone.
        'success-soft': 'border-transparent bg-success-soft text-success-soft-fg',
        'warning-soft': 'border-transparent bg-warning-soft text-warning-soft-fg',
        'info-soft': 'border-transparent bg-info-soft text-info-soft-fg',
        'destructive-soft': 'border-transparent bg-destructive-soft text-destructive-soft-fg',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);
