/** Optional asynchronous GPU timing. Never wait for a query or call gl.finish(). */
export class GpuTimer {
  private readonly extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private frame = 0;
  milliseconds: number | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  begin(): void {
    const ext = this.extension, gl = this.gl;
    if (!ext || gl.isContextLost()) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const q of this.pending) gl.deleteQuery(q);
      this.pending.length = 0;
      this.milliseconds = null;
      return;
    }
    while (this.pending.length && gl.getQueryParameter(this.pending[0]!, gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift()!;
      const ms = Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6;
      this.milliseconds = this.milliseconds === null ? ms : this.milliseconds * .8 + ms * .2;
      gl.deleteQuery(q);
    }
    // Sampling every fourth frame keeps the profiler itself inexpensive.
    if (this.frame++ % 4 || this.pending.length >= 4) return;
    this.active = gl.createQuery();
    if (this.active) gl.beginQuery(ext.TIME_ELAPSED_EXT, this.active);
  }

  end(): void {
    if (!this.active || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }
}
