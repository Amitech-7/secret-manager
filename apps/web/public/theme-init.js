// Runs before the first paint so the page never flashes the wrong theme. It is a separate
// same-origin file (not an inline script) so a strict Content Security Policy can allow it.
// It only reads appearance preferences and only applies a fixed list of colour variables.
;(function () {
  var root = document.documentElement
  try {
    var data = JSON.parse(localStorage.getItem('sm-theme') || '{}') || {}
    var modes = { light: 1, dark: 1, night: 1, system: 1 }
    var mode = modes[data.mode] === 1 ? data.mode : 'system'
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    var theme = mode === 'system' ? (dark ? 'dark' : 'light') : mode
    root.setAttribute('data-theme', theme)

    var allowed = [
      '--sm-accent',
      '--sm-accent-hover',
      '--sm-on-accent',
      '--sm-accent-subtle',
      '--sm-link',
    ]
    var vars = data.vars && data.vars[theme]
    if (vars) {
      for (var i = 0; i < allowed.length; i++) {
        var value = vars[allowed[i]]
        if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
          root.style.setProperty(allowed[i], value)
      }
    }
    var color = data.themeColor && data.themeColor[theme]
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta && typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
      meta.setAttribute('content', color)
  } catch {
    root.setAttribute('data-theme', 'light')
  }
})()
