import { performance } from 'node:perf_hooks';
import { calculateBulletinAverages } from '@/common/utils/bulletin-calculation.util';

describe('bulletin batch performance', () => {
  it('calculates 5,000 student bulletins within the regression budget', () => {
    const studentIds = Array.from({ length: 5_000 }, (_, index) => `eleve-${index}`);
    const notes = studentIds.flatMap((eleveId, index) => [
      { eleveId, matiereId: 'maths', note: 10 + (index % 10), noteSur: 20 },
      { eleveId, matiereId: 'francais', note: 9 + (index % 10), noteSur: 20 },
      { eleveId, matiereId: 'anglais', note: 8 + (index % 10), noteSur: 20 },
      { eleveId, matiereId: 'histoire', note: 7 + (index % 10), noteSur: 20 },
    ]);

    const startedAt = performance.now();
    const averages = calculateBulletinAverages(
      studentIds,
      notes,
      new Map([
        ['maths', 4],
        ['francais', 3],
        ['anglais', 2],
        ['histoire', 1],
      ]),
    );
    const elapsedMs = performance.now() - startedAt;

    expect(averages.size).toBe(5_000);
    expect(elapsedMs).toBeLessThan(500);
  });
});
