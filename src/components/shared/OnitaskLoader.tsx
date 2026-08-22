'use client';

import { useEffect, useState } from 'react';
import styles from './OnitaskLoader.module.css';

export default function OnitaskLoader() {
  const [activeDot, setActiveDot] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveDot((prev) => (prev + 1) % 3);
    }, 650);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.loader} role="status" aria-label="Onitask загружается">
      {/* Обёртка без clip-path — здесь живёт SVG */}
      <div className={styles.cardWrapper}>
        <svg
          className={styles.borderGlow}
          viewBox="0 0 280 280"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className={styles.borderGlowPath}
            pathLength={100}
            strokeDasharray="18 82"
            d="M16,0 L276,0 A4,4 0 0 1 280,4 L280,264 L264,280 L4,280 A4,4 0 0 1 0,276 L0,16 Z"
          />
        </svg>

        {/* Клип только здесь */}
        <div className={styles.cardOuter}>
          <div className={styles.card}>
            <div className={styles.ambientGlow} />
            <div className={styles.logoContainer}>
              <svg className={styles.mark} viewBox="200 190 250 260" aria-hidden="true">
                <path
                  d="M422 203 C408 234 397 254 390 268 C379 286 370 300 362 312 C346 333 334 348 323 361 L290 395 L253 351 C238 329 224 301 215 280 C212 295 211 307 211 319 C211 338 213 353 215 365 C219 380 225 393 232 404 C240 416 249 426 257 434 L255 410 L287 433 L301 439 L363 396 L359 432 L391 395 C406 378 416 360 422 342 C428 324 431 304 431 285 L427 241 Z"
                  fill="currentColor"
                />
              </svg>
              <div className={styles.logoGlow} />
            </div>

            <div className={styles.status}>
              <div className={styles.brand}>ONITASK</div>
              <div className={styles.loadingText}>Загрузка...</div>
              <div className={styles.dots}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={`${styles.dot} ${activeDot === i ? styles.active : ''}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}