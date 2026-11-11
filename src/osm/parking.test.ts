import { EMPTY_DOC } from './types';
import { retagKind, retagLevels, disabledFor, isOutlineWay, isParkingArea, parkingInfo, PARKING_TEMPLATES, placeParking, placesFor, streetPlaces, withCapacity, withParkingKind } from './parking';

describe('car parks', () => {
  const placed = () => placeParking(EMPTY_DOC, [104.26, 52.26], PARKING_TEMPLATES[1], 30);

  test('a placed car park is a closed area with standard tags and places by its area', () => {
    const { doc, id } = placed();
    const way = doc.ways[id];
    expect(isParkingArea(way)).toBe(true);
    expect(isOutlineWay(way)).toBe(true);
    expect(way.refs).toHaveLength(5);
    expect(way.tags).toMatchObject({ amenity: 'parking', parking: 'surface', fee: 'no', access: 'yes', capacity: '40' });
    const info = parkingInfo(doc, id)!;
    expect(info.areaM2).toBeCloseTo(1000, 0);
    expect(info.estimate).toBe(40);
    expect(info.capacity).toBe(40);
  });

  test('25 m² a place, times the storeys', () => {
    expect(placesFor(1000)).toBe(40);
    expect(placesFor(1000, 3)).toBe(120);
    expect(placesFor(10)).toBe(0);
  });

  test('a tenth of the places, at least one, goes to disabled drivers', () => {
    expect(disabledFor(40)).toBe(4);
    expect(disabledFor(5)).toBe(1);
    expect(disabledFor(0)).toBe(0);
    const { doc, id } = placed();
    expect(parkingInfo(doc, id)!.disabledShort).toBe(true);
    const fixed = { ...doc, ways: { ...doc.ways, [id]: { ...doc.ways[id], tags: { ...doc.ways[id].tags, 'capacity:disabled': '4' } } } };
    expect(parkingInfo(fixed, id)!.disabledShort).toBe(false);
  });

  test('a multi-storey car park becomes a building with storeys, and back', () => {
    const up = withParkingKind({ amenity: 'parking', parking: 'surface' }, 'multi-storey');
    expect(up).toMatchObject({ parking: 'multi-storey', building: 'parking', 'building:levels': '3' });
    const down = withParkingKind(up, 'underground');
    expect(down.building).toBeUndefined();
    expect(down['building:levels']).toBeUndefined();
    // A car park inside another building keeps that building.
    expect(withParkingKind({ amenity: 'parking', building: 'retail' }, 'surface').building).toBe('retail');
  });

  test('places are whole numbers or nothing', () => {
    expect(withCapacity({ amenity: 'parking' }, 'capacity', '12')).toMatchObject({ capacity: '12' });
    expect(withCapacity({ amenity: 'parking', capacity: '12' }, 'capacity', '')).not.toHaveProperty('capacity');
    expect(withCapacity({ amenity: 'parking', capacity: '12' }, 'capacity', '-3')).not.toHaveProperty('capacity');
    expect(withCapacity({ amenity: 'parking' }, 'capacity', '2.5')).not.toHaveProperty('capacity');
  });

  test('street parking places by how the cars stand', () => {
    expect(streetPlaces({ 'parking:both': 'lane' }, 60)).toBe(20);
    expect(streetPlaces({ 'parking:right': 'lane', 'parking:right:orientation': 'perpendicular' }, 60)).toBe(24);
    expect(streetPlaces({ 'parking:both': 'no' }, 60)).toBe(0);
    expect(streetPlaces({}, 60)).toBe(0);
  });

  test('an open line tagged as parking is not an area', () => {
    const { doc, id } = placed();
    const open = { ...doc.ways[id], refs: doc.ways[id].refs.slice(0, 4) };
    expect(isParkingArea(open)).toBe(false);
  });

  test('places counted by the area follow the storeys; typed-in places stay', () => {
    const lot = { amenity: 'parking', parking: 'surface', capacity: '40' };
    expect(retagKind(lot, 'multi-storey', 1000).capacity).toBe('120');
    expect(retagKind({ ...lot, capacity: '55' }, 'multi-storey', 1000).capacity).toBe('55');
    expect(retagKind(retagKind(lot, 'multi-storey', 1000), 'surface', 1000).capacity).toBe('40');
    const tower = retagKind(lot, 'multi-storey', 1000);
    expect(retagLevels(tower, 5, 1000)).toMatchObject({ 'building:levels': '5', capacity: '200' });
    expect(retagLevels(tower, 0, 1000)).toBe(tower);
  });
});
