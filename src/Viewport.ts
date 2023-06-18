import p5 from "p5";

export interface Viewport {
  mapX(x: number, p: p5): number;
  mapXinv(x: number, p: p5): number;
  mapY(y: number, p: p5): number;
  mapYinv(y: number, p: p5): number;
  translateX(ratio: number): void;
  translateY(ratio: number): void;
  zoomX(ratio: number, about: number): void;
  zoomY(ratio: number, about: number): void;
}

export class LogViewport {
  private minX: number;
  private minNote: number;
  private maxX: number;
  private maxNote: number;

  constructor(minX: number, minNote: number, maxX: number, maxNote: number) {
    this.minX = minX;
    this.minNote = minNote;
    this.maxX = maxX;
    this.maxNote = maxNote;
  }
  
  mapX(x: number, p: p5): number {
    return p.map(x, this.minX, this.maxX, 0, p.width);
  }

  mapXinv(x: number, p: p5): number {
    return p.map(x, 0, p.width, this.minX, this.maxX);
  }
  
  private noteToFreq(note: number): number {
      return 440 * Math.pow(2, (note - 69) / 12);
  }
  private freqToNote(freq: number): number {
    return 12 * Math.log2(freq / 440) + 69;
  }
  
  mapY(y: number, p: p5): number {
    return p.map(this.freqToNote(y), this.minNote, this.maxNote, p.height, 0);
  }

  mapYinv(y: number, p:p5): number {
    return this.noteToFreq(p.map(y, p.height, 0, this.minNote, this.maxNote));
  }
  
  translateX(ratio: number): void {
    const dx = (this.maxX - this.minX) * ratio;
    this.minX += dx;
    this.maxX += dx;
  }

  translateY(ratio: number): void {
    const dnote = (this.maxNote - this.minNote) * ratio;
    this.minNote += dnote;
    this.maxNote += dnote;
  }

  zoomX(ratio: number, about: number) {
      const oldWidth = this.maxX - this.minX;
      const newWidth = oldWidth / ratio;
      
      this.minX = about - (about - this.minX) * newWidth / oldWidth;
      this.maxX = this.minX + newWidth;
  }

  zoomY(ratio: number, about: number) {
      about = this.freqToNote(about);

      const oldHeight = this.maxNote - this.minNote;
      const newHeight = oldHeight / ratio;
      
      this.minNote = about - (about - this.minNote) * newHeight / oldHeight;
      this.maxNote = this.minNote + newHeight;
  }
}
