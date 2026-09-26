import { resolveClassCoefficients } from '@/common/utils/serie-coefficients.util';

describe('resolveClassCoefficients', () => {
  it('uses serie-specific coefficients before generic level and course coefficients', () => {
    const coefficients = resolveClassCoefficients({
      serie: 'S2',
      matiereNiveaux: [
        { matiereId: 'maths', serie: null, coefficient: 4 },
        { matiereId: 'maths', serie: 'S1', coefficient: 8 },
        { matiereId: 'maths', serie: 'S2', coefficient: 5 },
        { matiereId: 'svt', serie: null, coefficient: 2 },
      ],
      cours: [
        { matiereId: 'maths', coefficient: 1 },
        { matiereId: 'svt', coefficient: 3 },
        { matiereId: 'anglais', coefficient: 2 },
      ],
    });

    expect(coefficients).toEqual(new Map([
      ['maths', 5],
      ['svt', 2],
      ['anglais', 2],
    ]));
  });

  it('falls back to generic level coefficients when the class has no matching serie', () => {
    const coefficients = resolveClassCoefficients({
      serie: 'L2',
      matiereNiveaux: [
        { matiereId: 'maths', serie: null, coefficient: 4 },
        { matiereId: 'maths', serie: 'S2', coefficient: 5 },
      ],
      cours: [
        { matiereId: 'maths', coefficient: 1 },
      ],
    });

    expect(coefficients).toEqual(new Map([
      ['maths', 4],
    ]));
  });
});
