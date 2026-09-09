import { describe, expect, it } from 'vitest';
import { CameraInterpolation } from '../src/player/camera-interpolation.ts';

describe('camera interpolation', () => {
  it('produces even 120 Hz motion from 60 Hz simulation samples without changing physics', () => {
    const camera = new CameraInterpolation({x:0,y:2,z:0},0);
    const out = {x:0,y:0,z:0};
    const rendered: number[] = [];
    for (let step=1;step<=4;step++) {
      const simulation = {x:step,y:2,z:0};
      camera.record(simulation,0);
      camera.sample(0,out); rendered.push(out.x);
      camera.sample(.5,out); rendered.push(out.x);
      expect(simulation.x).toBe(step);
      expect(camera.current.x).toBe(step);
    }
    expect(rendered).toEqual([0,.5,1,1.5,2,2.5,3,3.5]);
  });
  it('snaps teleports and resume resets instead of flying through the intervening world', () => {
    const camera = new CameraInterpolation({x:0,y:2,z:0},0), out={x:0,y:0,z:0};
    camera.record({x:1,y:2,z:0},0);
    camera.syncTeleport({x:500,y:-20,z:650},1);
    camera.sample(.25,out);
    expect(out).toEqual({x:500,y:-20,z:650});
    camera.record({x:40,y:5,z:20},2);
    camera.sample(0,out); expect(out).toEqual({x:40,y:5,z:20});
    camera.record({x:41,y:5,z:20},2);
    camera.reset(camera.current,2);
    camera.sample(0,out); expect(out.x).toBe(41);
  });
  it('clamps the display pose between the two samples', () => {
    const camera = new CameraInterpolation({x:0,y:0,z:0},0), out={x:0,y:0,z:0};
    camera.record({x:1,y:2,z:3},0);
    camera.sample(-1,out); expect(out).toEqual({x:0,y:0,z:0});
    camera.sample(2,out); expect(out).toEqual({x:1,y:2,z:3});
  });
});
