import { describe, expect, it } from 'vitest';
import { buildStoryPointCalibrationBlock } from '../../supabase/functions/enrich-task/storyPointCalibration';

describe('buildStoryPointCalibrationBlock', () => {
  it('marks disabled calibration explicitly', () => {
    expect(JSON.parse(buildStoryPointCalibrationBlock({ enabled: false })))
      .toEqual({ enabled: false });
  });

  it('filters invalid legacy ranges before the prompt', () => {
    const payload = JSON.parse(buildStoryPointCalibrationBlock({
      enabled: true,
      values: [1, 2, 3, 5, 8],
      hours_per_sp: { '1': '10–2 часов', '2': 'abc', '3': '1000 часов' },
    }));

    expect(payload.time_ranges).toMatchObject({
      '1': 'не задан',
      '2': 'не задан',
      '3': 'не задан',
    });
  });

  it('fills missing ranges and keeps configured reference snapshots', () => {
    const payload = JSON.parse(buildStoryPointCalibrationBlock({
      enabled: true,
      values: [1, 2, 3, 5, 8],
      hours_per_sp: { '3': '6–10 часов' },
      reference_tasks: {
        '5': { task_id: 'done-5', full_id: 'TASK-5', title: 'Reference' },
      },
    }));

    expect(payload).toMatchObject({
      enabled: true,
      values: [1, 2, 3, 5, 8],
      time_ranges: {
        '1': '1–2 часа',
        '2': '2–4 часа',
        '3': '6–10 часов',
        '5': '8–16 часов',
        '8': '16–32 часа',
      },
      reference_tasks: {
        '5': { task_id: 'done-5', full_id: 'TASK-5', title: 'Reference' },
      },
    });
    expect(payload.usage).toContain('Reference tasks first');
  });
});
