export class QuantizationGrid {
    private xsnap: number;
    private ysnap: number;

    constructor(xsnap, ysnap) {
        this.xsnap = xsnap;
        this.ysnap = ysnap;
    }

    setXSnap(xsnap: number) {
        this.xsnap = xsnap;
    }

    snapX(x): number {
        if (xsnap == 0)
            return x;

        return xsnap * Math.round(x/xsnap);
    }

    setYSnap(ysnap: number) {
        this.ysnap = ysnap;
    }

    snapY(y): number {
        if (ysnap == 0)
            return y;

        return ysnap * Math.round(y/ysnap);
    }

    drawGrid(p: p5, viewport: Viewport) {
        p.stroke(200);
        p.strokeWeight(1);
        
        if (this.xsnap != 0) {
            const x0 = viewport.mapXinv(0, p);
            const xf = viewport.mapXinv(p.width, p);
            for (let x = x0; x < xf; x += this.xsnap) {
              p.line(viewport.mapX(x, p), 0, viewport.mapX(x, p), p.height);
            }
        }

        if (this.ysnap != 0) {
            const y0 = viewport.mapYinv(p.height, p);
            const yf = viewport.mapYinv(0, p);
            for (let y = y0; y < yf; y += this.ysnap) {
              p.line(0, viewport.mapY(y, p), p.width, viewport.mapY(y, p));
            }
        }
    }
}
