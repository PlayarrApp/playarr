import {trackY} from './TrackStack';

const person = {id: 'cast', items: [{person: true}]} as never;
const chapters = {id: 'chapters', items: [{}]} as never;

describe('trackY', () => {
  it('uses the web film page pitches: chapters 351, cast and crew 284.2', () => {
    expect(trackY([chapters, person, person], 540, 1)).toBeCloseTo(891, 1);
    expect(trackY([chapters, person, person], 540, 2)).toBeCloseTo(1175.2, 1);
  });
});
