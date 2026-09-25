import { test } from "node:test";
import assert from "node:assert/strict";
import { Bounds, WindowPort, WindowPresentation } from "../window-presentation";

const desktop = {x:0,y:0,width:1920,height:1080};
const normal = {x:160,y:100,width:1360,height:900};
class FakeWindow implements WindowPort {
  bounds = {...normal};
  fullscreen = false;
  calls: string[] = [];
  getBounds() { return {...this.bounds}; }
  getNormalBounds() { return {...normal}; }
  setBounds(b: Bounds) { this.calls.push("bounds"); this.bounds={...b}; }
  isFullScreen() { return this.fullscreen; }
  setFullScreen(v: boolean) { this.calls.push("fullscreen"); this.fullscreen=v; }
  setClosable() { this.calls.push("closable"); }
  setMinimizable() { this.calls.push("minimizable"); }
  setResizable() { this.calls.push("resizable"); }
  setAlwaysOnTop() { this.calls.push("topmost"); }
  isVisible() { return true; }
  show() { this.calls.push("show"); }
}
test("unlock leaves fullscreen size and visibility unchanged until Escape",()=>{
  const w=new FakeWindow(), p=new WindowPresentation(w);
  p.applyLock(true,desktop);
  assert.deepEqual(w.bounds,desktop);
  assert.equal(p.escape(),false);
  w.calls=[];
  p.applyLock(false,desktop);
  assert.deepEqual(w.bounds,desktop);
  assert.ok(p.coversDisplay);
  assert.deepEqual(w.calls,["closable","minimizable","resizable","topmost"]);
  w.calls=[];
  assert.equal(p.escape(),true);
  assert.deepEqual(w.bounds,normal);
  assert.equal(p.coversDisplay,false);
  assert.deepEqual(w.calls,["bounds"]);
  assert.equal(p.escape(),false);
});
test("steady state and repeated unchanged monitor notifications do not reposition windows",()=>{
  const w=new FakeWindow(), p=new WindowPresentation(w);
  p.applyLock(true,desktop); w.calls=[];
  for(let i=0;i<20;i++)p.applyLock(true,{...desktop});
  assert.deepEqual(w.calls,[]);
  p.applyLock(false,desktop); w.calls=[];
  for(let i=0;i<20;i++)p.applyLock(false,{...desktop});
  assert.deepEqual(w.calls,[]);
});
test("a real monitor size change is applied once without losing the restore bounds",()=>{
  const w=new FakeWindow(), p=new WindowPresentation(w);
  p.applyLock(true,desktop); w.calls=[];
  const resized={...desktop,width:2560,height:1440};
  p.applyLock(true,resized);
  assert.deepEqual(w.calls,["bounds"]);
  p.applyLock(false,resized); p.applyLock(true,resized);
  p.applyLock(false,resized); p.escape();
  assert.deepEqual(w.bounds,normal);
});
test("Escape also exits user-selected native fullscreen after unlock",()=>{
  const w=new FakeWindow(), p=new WindowPresentation(w);
  p.applyLock(false,desktop); w.fullscreen=true; w.calls=[];
  assert.equal(p.escape(),true);
  assert.equal(w.fullscreen,false);
  assert.deepEqual(w.calls,["fullscreen"]);
});
