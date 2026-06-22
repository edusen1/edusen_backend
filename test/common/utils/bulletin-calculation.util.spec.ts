import { calculateBulletinAverages } from '@/common/utils/bulletin-calculation.util';

describe('calculateBulletinAverages', () => {
  it('calculates weighted averages for a complete class in one pass', () => {
    const averages = calculateBulletinAverages(
      ['eleve-a', 'eleve-b', 'eleve-sans-note'],
      [
        { eleveId: 'eleve-a', matiereId: 'maths', note: 15, noteSur: 20 },
        { eleveId: 'eleve-a', matiereId: 'francais', note: 10, noteSur: 20 },
        { eleveId: 'eleve-b', matiereId: 'maths', note: 12, noteSur: 20 },
      ],
      new Map([
        ['maths', 3],
        ['francais', 1],
      ]),
    );

    expect(averages.get('eleve-a')).toBe(13.75);
    expect(averages.get('eleve-b')).toBe(12);
    expect(averages.get('eleve-sans-note')).toBe(0);
  });
});
