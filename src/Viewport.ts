import p5 from "p5";

export class Viewport {
  private minX: number;
  private minY: number;
  private maxX: number;
  private maxY: number;

  constructor(minX: number, minY: number, maxX: number, maxY: number) {
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  mapX(x: number, p: p5): number {
    return p.map(x, this.minX, this.maxX, 0, p.width);
  }

  mapXinv(x: number, p: p5): number {
    return p.map(x, 0, p.width, this.minX, this.maxX);
  }

  mapY(y: number, p: p5): number {
    return p.map(y, this.minY, this.maxY, p.height, 0);
  }

  mapYinv(y: number, p:p5): number {
    return p.map(y, p.height, 0, this.minY, this.maxY);
  }
}
