/** Portable terminal progress. Redirected output and NO_COLOR stay plain and stable. */
export class Progress {
  constructor(output = process.stdout, env = process.env) {
    this.output = output
    this.animated = Boolean(output.isTTY && !('NO_COLOR' in env) && env.TERM !== 'dumb')
    this.index = 0
    this.total = 6
    this.timer = undefined
    this.current = undefined
  }

  start(label) {
    this.finish()
    this.current = label
    this.index += 1
    this.started = Date.now()
    let frame = 0
    const draw = () =>
      this.output.write(
        `\r\x1b[2K\x1b[36m${['|', '/', '-', '\\'][frame++ % 4]} [${this.index}/${this.total}]\x1b[0m ${label} (${Math.floor((Date.now() - this.started) / 1000)}s)`
      )
    if (this.animated) {
      draw()
      this.timer = setInterval(draw, 100)
      this.timer.unref()
    } else this.output.write(`[${this.index}/${this.total}] ${label}\n`)
  }

  finish(failed = false) {
    clearInterval(this.timer)
    this.timer = undefined
    if (!this.current) return
    const prefix = this.animated ? `\r\x1b[2K\x1b[${failed ? '31' : '32'}m` : ''
    const suffix = this.animated ? '\x1b[0m' : ''
    this.output.write(
      `${prefix}${failed ? 'FAIL' : 'OK'} [${this.index}/${this.total}] ${this.current}${suffix}\n`
    )
    this.current = undefined
  }
}
