import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {Image} from 'react-native';
import {ArtworkImage} from './ArtworkImage';
import {trackParityActivity} from '../debug/parityControl';

jest.mock('../debug/parityControl', () => ({trackParityActivity: jest.fn()}));

describe('ArtworkImage native request tracking', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps overlapping native requests pending until each one ends', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ArtworkImage uri="asset-a" accessToken="token" />);
    });
    const image = renderer.root.findByType(Image);
    act(() => {
      image.props.onLoadStart();
      image.props.onLoadStart();
      image.props.onLoadEnd();
    });
    expect(trackParityActivity).toHaveBeenNthCalledWith(1, 'image', 1);
    expect(trackParityActivity).toHaveBeenNthCalledWith(2, 'image', 1);
    expect(trackParityActivity).toHaveBeenNthCalledWith(3, 'image', -1);
    expect(trackParityActivity).toHaveBeenCalledTimes(3);

    act(() => image.props.onLoadEnd());
    expect(trackParityActivity).toHaveBeenLastCalledWith('image', -1);
    expect(trackParityActivity).toHaveBeenCalledTimes(4);
    act(() => renderer.unmount());
  });

  it('balances a pending native request when an errored image unmounts without load-end', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ArtworkImage uri="asset-a" accessToken="token" />);
    });
    const image = renderer.root.findByType(Image);
    act(() => image.props.onLoadStart());
    expect(trackParityActivity).toHaveBeenCalledWith('image', 1);

    act(() => image.props.onError({nativeEvent: {error: 'failed'}}));
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(trackParityActivity).toHaveBeenLastCalledWith('image', -1);
    expect(trackParityActivity).toHaveBeenCalledTimes(2);
    act(() => renderer.unmount());
  });
});
