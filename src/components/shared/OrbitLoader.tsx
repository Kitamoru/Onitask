import type { CSSProperties } from 'react';
import styles from './OrbitLoader.module.css';

interface OrbitLoaderProps {
  /** Диаметр орбиты в px. Внутренние пропорции масштабируются автоматически. */
  size?: number;
  /** Текстовая метка для скринридеров (role="status"). */
  label?: string;
  className?: string;
}

/**
 * OrbitLoader — компактный индикатор загрузки «орбита» (вариант H).
 *
 * Заменяет текстовые «Загрузка...» внутри приложения.
 */
export function OrbitLoader({
  size = 40,
  label = 'Загрузка',
  className,
}: OrbitLoaderProps) {
  return (
    <span
      className={className ? `${styles.orbit} ${className}` : styles.orbit}
      style={{ '--orbit-size': `${size}px` } as CSSProperties}
      role="status"
      aria-label={label}
    >
      <span className={styles.core} />
      <span className={styles.track}>
        <span className={styles.dot} />
      </span>
    </span>
  );
}
