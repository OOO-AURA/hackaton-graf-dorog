import { sidewalkWidth, taggedSidewalks, withSidewalks, withSidewalkWidth } from './sidewalks';

describe('sidewalks of a road', () => {
  test('sides come from sidewalk or its per-side keys', () => {
    expect(taggedSidewalks({ sidewalk: 'both' })).toBe('both');
    expect(taggedSidewalks({ 'sidewalk:left': 'yes' })).toBe('left');
    expect(taggedSidewalks({ highway: 'residential' })).toBeNull();
  });

  test('changing sides keeps the width on the sides that stay', () => {
    const both = withSidewalkWidth(withSidewalks({ highway: 'residential' }, 'both'), 3);
    expect(both).toMatchObject({ sidewalk: 'both', 'sidewalk:both:width': '3' });
    const left = withSidewalks(both, 'left');
    expect(left).toMatchObject({ sidewalk: 'left', 'sidewalk:left:width': '3' });
    expect(left['sidewalk:both:width']).toBeUndefined();
    expect(sidewalkWidth(left)).toBe(3);
    expect(withSidewalks(left, 'no')).toEqual({ highway: 'residential', sidewalk: 'no' });
  });
});
