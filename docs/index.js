(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.AttentionVis = factory());
}(this, (function () { 'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail);
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
            }
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    let SvelteElement;
    if (typeof HTMLElement === 'function') {
        SvelteElement = class extends HTMLElement {
            constructor() {
                super();
                this.attachShadow({ mode: 'open' });
            }
            connectedCallback() {
                // @ts-ignore todo: improve typings
                for (const key in this.$$.slotted) {
                    // @ts-ignore todo: improve typings
                    this.appendChild(this.$$.slotted[key]);
                }
            }
            attributeChangedCallback(attr, _oldValue, newValue) {
                this[attr] = newValue;
            }
            $destroy() {
                destroy_component(this, 1);
                this.$destroy = noop;
            }
            $on(type, callback) {
                // TODO should this delegate to addEventListener?
                const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
                callbacks.push(callback);
                return () => {
                    const index = callbacks.indexOf(callback);
                    if (index !== -1)
                        callbacks.splice(index, 1);
                };
            }
            $set($$props) {
                if (this.$$set && !is_empty($$props)) {
                    this.$$.skip_bound = true;
                    this.$$set($$props);
                    this.$$.skip_bound = false;
                }
            }
        };
    }

    function ascending(a, b) {
      return a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
    }

    function bisector(f) {
      let delta = f;
      let compare = f;

      if (f.length === 1) {
        delta = (d, x) => f(d) - x;
        compare = ascendingComparator(f);
      }

      function left(a, x, lo, hi) {
        if (lo == null) lo = 0;
        if (hi == null) hi = a.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (compare(a[mid], x) < 0) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      }

      function right(a, x, lo, hi) {
        if (lo == null) lo = 0;
        if (hi == null) hi = a.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (compare(a[mid], x) > 0) hi = mid;
          else lo = mid + 1;
        }
        return lo;
      }

      function center(a, x, lo, hi) {
        if (lo == null) lo = 0;
        if (hi == null) hi = a.length;
        const i = left(a, x, lo, hi - 1);
        return i > lo && delta(a[i - 1], x) > -delta(a[i], x) ? i - 1 : i;
      }

      return {left, center, right};
    }

    function ascendingComparator(f) {
      return (d, x) => ascending(f(d), x);
    }

    function number(x) {
      return x === null ? NaN : +x;
    }

    const ascendingBisect = bisector(ascending);
    const bisectRight = ascendingBisect.right;
    const bisectCenter = bisector(number).center;

    var e10 = Math.sqrt(50),
        e5 = Math.sqrt(10),
        e2 = Math.sqrt(2);

    function ticks(start, stop, count) {
      var reverse,
          i = -1,
          n,
          ticks,
          step;

      stop = +stop, start = +start, count = +count;
      if (start === stop && count > 0) return [start];
      if (reverse = stop < start) n = start, start = stop, stop = n;
      if ((step = tickIncrement(start, stop, count)) === 0 || !isFinite(step)) return [];

      if (step > 0) {
        start = Math.ceil(start / step);
        stop = Math.floor(stop / step);
        ticks = new Array(n = Math.ceil(stop - start + 1));
        while (++i < n) ticks[i] = (start + i) * step;
      } else {
        step = -step;
        start = Math.ceil(start * step);
        stop = Math.floor(stop * step);
        ticks = new Array(n = Math.ceil(stop - start + 1));
        while (++i < n) ticks[i] = (start + i) / step;
      }

      if (reverse) ticks.reverse();

      return ticks;
    }

    function tickIncrement(start, stop, count) {
      var step = (stop - start) / Math.max(0, count),
          power = Math.floor(Math.log(step) / Math.LN10),
          error = step / Math.pow(10, power);
      return power >= 0
          ? (error >= e10 ? 10 : error >= e5 ? 5 : error >= e2 ? 2 : 1) * Math.pow(10, power)
          : -Math.pow(10, -power) / (error >= e10 ? 10 : error >= e5 ? 5 : error >= e2 ? 2 : 1);
    }

    function tickStep(start, stop, count) {
      var step0 = Math.abs(stop - start) / Math.max(0, count),
          step1 = Math.pow(10, Math.floor(Math.log(step0) / Math.LN10)),
          error = step0 / step1;
      if (error >= e10) step1 *= 10;
      else if (error >= e5) step1 *= 5;
      else if (error >= e2) step1 *= 2;
      return stop < start ? -step1 : step1;
    }

    function max(values, valueof) {
      let max;
      if (valueof === undefined) {
        for (const value of values) {
          if (value != null
              && (max < value || (max === undefined && value >= value))) {
            max = value;
          }
        }
      } else {
        let index = -1;
        for (let value of values) {
          if ((value = valueof(value, ++index, values)) != null
              && (max < value || (max === undefined && value >= value))) {
            max = value;
          }
        }
      }
      return max;
    }

    function min(values, valueof) {
      let min;
      if (valueof === undefined) {
        for (const value of values) {
          if (value != null
              && (min > value || (min === undefined && value >= value))) {
            min = value;
          }
        }
      } else {
        let index = -1;
        for (let value of values) {
          if ((value = valueof(value, ++index, values)) != null
              && (min > value || (min === undefined && value >= value))) {
            min = value;
          }
        }
      }
      return min;
    }

    function sum(values, valueof) {
      let sum = 0;
      if (valueof === undefined) {
        for (let value of values) {
          if (value = +value) {
            sum += value;
          }
        }
      } else {
        let index = -1;
        for (let value of values) {
          if (value = +valueof(value, ++index, values)) {
            sum += value;
          }
        }
      }
      return sum;
    }

    function transpose(matrix) {
      if (!(n = matrix.length)) return [];
      for (var i = -1, m = min(matrix, length), transpose = new Array(m); ++i < m;) {
        for (var j = -1, n, row = transpose[i] = new Array(n); ++j < n;) {
          row[j] = matrix[j][i];
        }
      }
      return transpose;
    }

    function length(d) {
      return d.length;
    }

    function zip() {
      return transpose(arguments);
    }

    var noop$1 = {value: () => {}};

    function dispatch() {
      for (var i = 0, n = arguments.length, _ = {}, t; i < n; ++i) {
        if (!(t = arguments[i] + "") || (t in _) || /[\s.]/.test(t)) throw new Error("illegal type: " + t);
        _[t] = [];
      }
      return new Dispatch(_);
    }

    function Dispatch(_) {
      this._ = _;
    }

    function parseTypenames(typenames, types) {
      return typenames.trim().split(/^|\s+/).map(function(t) {
        var name = "", i = t.indexOf(".");
        if (i >= 0) name = t.slice(i + 1), t = t.slice(0, i);
        if (t && !types.hasOwnProperty(t)) throw new Error("unknown type: " + t);
        return {type: t, name: name};
      });
    }

    Dispatch.prototype = dispatch.prototype = {
      constructor: Dispatch,
      on: function(typename, callback) {
        var _ = this._,
            T = parseTypenames(typename + "", _),
            t,
            i = -1,
            n = T.length;

        // If no callback was specified, return the callback of the given type and name.
        if (arguments.length < 2) {
          while (++i < n) if ((t = (typename = T[i]).type) && (t = get(_[t], typename.name))) return t;
          return;
        }

        // If a type was specified, set the callback for the given type and name.
        // Otherwise, if a null callback was specified, remove callbacks of the given name.
        if (callback != null && typeof callback !== "function") throw new Error("invalid callback: " + callback);
        while (++i < n) {
          if (t = (typename = T[i]).type) _[t] = set(_[t], typename.name, callback);
          else if (callback == null) for (t in _) _[t] = set(_[t], typename.name, null);
        }

        return this;
      },
      copy: function() {
        var copy = {}, _ = this._;
        for (var t in _) copy[t] = _[t].slice();
        return new Dispatch(copy);
      },
      call: function(type, that) {
        if ((n = arguments.length - 2) > 0) for (var args = new Array(n), i = 0, n, t; i < n; ++i) args[i] = arguments[i + 2];
        if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
        for (t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
      },
      apply: function(type, that, args) {
        if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
        for (var t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
      }
    };

    function get(type, name) {
      for (var i = 0, n = type.length, c; i < n; ++i) {
        if ((c = type[i]).name === name) {
          return c.value;
        }
      }
    }

    function set(type, name, callback) {
      for (var i = 0, n = type.length; i < n; ++i) {
        if (type[i].name === name) {
          type[i] = noop$1, type = type.slice(0, i).concat(type.slice(i + 1));
          break;
        }
      }
      if (callback != null) type.push({name: name, value: callback});
      return type;
    }

    function define(constructor, factory, prototype) {
      constructor.prototype = factory.prototype = prototype;
      prototype.constructor = constructor;
    }

    function extend(parent, definition) {
      var prototype = Object.create(parent.prototype);
      for (var key in definition) prototype[key] = definition[key];
      return prototype;
    }

    function Color() {}

    var darker = 0.7;
    var brighter = 1 / darker;

    var reI = "\\s*([+-]?\\d+)\\s*",
        reN = "\\s*([+-]?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?)\\s*",
        reP = "\\s*([+-]?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?)%\\s*",
        reHex = /^#([0-9a-f]{3,8})$/,
        reRgbInteger = new RegExp("^rgb\\(" + [reI, reI, reI] + "\\)$"),
        reRgbPercent = new RegExp("^rgb\\(" + [reP, reP, reP] + "\\)$"),
        reRgbaInteger = new RegExp("^rgba\\(" + [reI, reI, reI, reN] + "\\)$"),
        reRgbaPercent = new RegExp("^rgba\\(" + [reP, reP, reP, reN] + "\\)$"),
        reHslPercent = new RegExp("^hsl\\(" + [reN, reP, reP] + "\\)$"),
        reHslaPercent = new RegExp("^hsla\\(" + [reN, reP, reP, reN] + "\\)$");

    var named = {
      aliceblue: 0xf0f8ff,
      antiquewhite: 0xfaebd7,
      aqua: 0x00ffff,
      aquamarine: 0x7fffd4,
      azure: 0xf0ffff,
      beige: 0xf5f5dc,
      bisque: 0xffe4c4,
      black: 0x000000,
      blanchedalmond: 0xffebcd,
      blue: 0x0000ff,
      blueviolet: 0x8a2be2,
      brown: 0xa52a2a,
      burlywood: 0xdeb887,
      cadetblue: 0x5f9ea0,
      chartreuse: 0x7fff00,
      chocolate: 0xd2691e,
      coral: 0xff7f50,
      cornflowerblue: 0x6495ed,
      cornsilk: 0xfff8dc,
      crimson: 0xdc143c,
      cyan: 0x00ffff,
      darkblue: 0x00008b,
      darkcyan: 0x008b8b,
      darkgoldenrod: 0xb8860b,
      darkgray: 0xa9a9a9,
      darkgreen: 0x006400,
      darkgrey: 0xa9a9a9,
      darkkhaki: 0xbdb76b,
      darkmagenta: 0x8b008b,
      darkolivegreen: 0x556b2f,
      darkorange: 0xff8c00,
      darkorchid: 0x9932cc,
      darkred: 0x8b0000,
      darksalmon: 0xe9967a,
      darkseagreen: 0x8fbc8f,
      darkslateblue: 0x483d8b,
      darkslategray: 0x2f4f4f,
      darkslategrey: 0x2f4f4f,
      darkturquoise: 0x00ced1,
      darkviolet: 0x9400d3,
      deeppink: 0xff1493,
      deepskyblue: 0x00bfff,
      dimgray: 0x696969,
      dimgrey: 0x696969,
      dodgerblue: 0x1e90ff,
      firebrick: 0xb22222,
      floralwhite: 0xfffaf0,
      forestgreen: 0x228b22,
      fuchsia: 0xff00ff,
      gainsboro: 0xdcdcdc,
      ghostwhite: 0xf8f8ff,
      gold: 0xffd700,
      goldenrod: 0xdaa520,
      gray: 0x808080,
      green: 0x008000,
      greenyellow: 0xadff2f,
      grey: 0x808080,
      honeydew: 0xf0fff0,
      hotpink: 0xff69b4,
      indianred: 0xcd5c5c,
      indigo: 0x4b0082,
      ivory: 0xfffff0,
      khaki: 0xf0e68c,
      lavender: 0xe6e6fa,
      lavenderblush: 0xfff0f5,
      lawngreen: 0x7cfc00,
      lemonchiffon: 0xfffacd,
      lightblue: 0xadd8e6,
      lightcoral: 0xf08080,
      lightcyan: 0xe0ffff,
      lightgoldenrodyellow: 0xfafad2,
      lightgray: 0xd3d3d3,
      lightgreen: 0x90ee90,
      lightgrey: 0xd3d3d3,
      lightpink: 0xffb6c1,
      lightsalmon: 0xffa07a,
      lightseagreen: 0x20b2aa,
      lightskyblue: 0x87cefa,
      lightslategray: 0x778899,
      lightslategrey: 0x778899,
      lightsteelblue: 0xb0c4de,
      lightyellow: 0xffffe0,
      lime: 0x00ff00,
      limegreen: 0x32cd32,
      linen: 0xfaf0e6,
      magenta: 0xff00ff,
      maroon: 0x800000,
      mediumaquamarine: 0x66cdaa,
      mediumblue: 0x0000cd,
      mediumorchid: 0xba55d3,
      mediumpurple: 0x9370db,
      mediumseagreen: 0x3cb371,
      mediumslateblue: 0x7b68ee,
      mediumspringgreen: 0x00fa9a,
      mediumturquoise: 0x48d1cc,
      mediumvioletred: 0xc71585,
      midnightblue: 0x191970,
      mintcream: 0xf5fffa,
      mistyrose: 0xffe4e1,
      moccasin: 0xffe4b5,
      navajowhite: 0xffdead,
      navy: 0x000080,
      oldlace: 0xfdf5e6,
      olive: 0x808000,
      olivedrab: 0x6b8e23,
      orange: 0xffa500,
      orangered: 0xff4500,
      orchid: 0xda70d6,
      palegoldenrod: 0xeee8aa,
      palegreen: 0x98fb98,
      paleturquoise: 0xafeeee,
      palevioletred: 0xdb7093,
      papayawhip: 0xffefd5,
      peachpuff: 0xffdab9,
      peru: 0xcd853f,
      pink: 0xffc0cb,
      plum: 0xdda0dd,
      powderblue: 0xb0e0e6,
      purple: 0x800080,
      rebeccapurple: 0x663399,
      red: 0xff0000,
      rosybrown: 0xbc8f8f,
      royalblue: 0x4169e1,
      saddlebrown: 0x8b4513,
      salmon: 0xfa8072,
      sandybrown: 0xf4a460,
      seagreen: 0x2e8b57,
      seashell: 0xfff5ee,
      sienna: 0xa0522d,
      silver: 0xc0c0c0,
      skyblue: 0x87ceeb,
      slateblue: 0x6a5acd,
      slategray: 0x708090,
      slategrey: 0x708090,
      snow: 0xfffafa,
      springgreen: 0x00ff7f,
      steelblue: 0x4682b4,
      tan: 0xd2b48c,
      teal: 0x008080,
      thistle: 0xd8bfd8,
      tomato: 0xff6347,
      turquoise: 0x40e0d0,
      violet: 0xee82ee,
      wheat: 0xf5deb3,
      white: 0xffffff,
      whitesmoke: 0xf5f5f5,
      yellow: 0xffff00,
      yellowgreen: 0x9acd32
    };

    define(Color, color, {
      copy: function(channels) {
        return Object.assign(new this.constructor, this, channels);
      },
      displayable: function() {
        return this.rgb().displayable();
      },
      hex: color_formatHex, // Deprecated! Use color.formatHex.
      formatHex: color_formatHex,
      formatHsl: color_formatHsl,
      formatRgb: color_formatRgb,
      toString: color_formatRgb
    });

    function color_formatHex() {
      return this.rgb().formatHex();
    }

    function color_formatHsl() {
      return hslConvert(this).formatHsl();
    }

    function color_formatRgb() {
      return this.rgb().formatRgb();
    }

    function color(format) {
      var m, l;
      format = (format + "").trim().toLowerCase();
      return (m = reHex.exec(format)) ? (l = m[1].length, m = parseInt(m[1], 16), l === 6 ? rgbn(m) // #ff0000
          : l === 3 ? new Rgb((m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), ((m & 0xf) << 4) | (m & 0xf), 1) // #f00
          : l === 8 ? rgba(m >> 24 & 0xff, m >> 16 & 0xff, m >> 8 & 0xff, (m & 0xff) / 0xff) // #ff000000
          : l === 4 ? rgba((m >> 12 & 0xf) | (m >> 8 & 0xf0), (m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), (((m & 0xf) << 4) | (m & 0xf)) / 0xff) // #f000
          : null) // invalid hex
          : (m = reRgbInteger.exec(format)) ? new Rgb(m[1], m[2], m[3], 1) // rgb(255, 0, 0)
          : (m = reRgbPercent.exec(format)) ? new Rgb(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, 1) // rgb(100%, 0%, 0%)
          : (m = reRgbaInteger.exec(format)) ? rgba(m[1], m[2], m[3], m[4]) // rgba(255, 0, 0, 1)
          : (m = reRgbaPercent.exec(format)) ? rgba(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, m[4]) // rgb(100%, 0%, 0%, 1)
          : (m = reHslPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, 1) // hsl(120, 50%, 50%)
          : (m = reHslaPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, m[4]) // hsla(120, 50%, 50%, 1)
          : named.hasOwnProperty(format) ? rgbn(named[format]) // eslint-disable-line no-prototype-builtins
          : format === "transparent" ? new Rgb(NaN, NaN, NaN, 0)
          : null;
    }

    function rgbn(n) {
      return new Rgb(n >> 16 & 0xff, n >> 8 & 0xff, n & 0xff, 1);
    }

    function rgba(r, g, b, a) {
      if (a <= 0) r = g = b = NaN;
      return new Rgb(r, g, b, a);
    }

    function rgbConvert(o) {
      if (!(o instanceof Color)) o = color(o);
      if (!o) return new Rgb;
      o = o.rgb();
      return new Rgb(o.r, o.g, o.b, o.opacity);
    }

    function rgb(r, g, b, opacity) {
      return arguments.length === 1 ? rgbConvert(r) : new Rgb(r, g, b, opacity == null ? 1 : opacity);
    }

    function Rgb(r, g, b, opacity) {
      this.r = +r;
      this.g = +g;
      this.b = +b;
      this.opacity = +opacity;
    }

    define(Rgb, rgb, extend(Color, {
      brighter: function(k) {
        k = k == null ? brighter : Math.pow(brighter, k);
        return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
      },
      darker: function(k) {
        k = k == null ? darker : Math.pow(darker, k);
        return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
      },
      rgb: function() {
        return this;
      },
      displayable: function() {
        return (-0.5 <= this.r && this.r < 255.5)
            && (-0.5 <= this.g && this.g < 255.5)
            && (-0.5 <= this.b && this.b < 255.5)
            && (0 <= this.opacity && this.opacity <= 1);
      },
      hex: rgb_formatHex, // Deprecated! Use color.formatHex.
      formatHex: rgb_formatHex,
      formatRgb: rgb_formatRgb,
      toString: rgb_formatRgb
    }));

    function rgb_formatHex() {
      return "#" + hex(this.r) + hex(this.g) + hex(this.b);
    }

    function rgb_formatRgb() {
      var a = this.opacity; a = isNaN(a) ? 1 : Math.max(0, Math.min(1, a));
      return (a === 1 ? "rgb(" : "rgba(")
          + Math.max(0, Math.min(255, Math.round(this.r) || 0)) + ", "
          + Math.max(0, Math.min(255, Math.round(this.g) || 0)) + ", "
          + Math.max(0, Math.min(255, Math.round(this.b) || 0))
          + (a === 1 ? ")" : ", " + a + ")");
    }

    function hex(value) {
      value = Math.max(0, Math.min(255, Math.round(value) || 0));
      return (value < 16 ? "0" : "") + value.toString(16);
    }

    function hsla(h, s, l, a) {
      if (a <= 0) h = s = l = NaN;
      else if (l <= 0 || l >= 1) h = s = NaN;
      else if (s <= 0) h = NaN;
      return new Hsl(h, s, l, a);
    }

    function hslConvert(o) {
      if (o instanceof Hsl) return new Hsl(o.h, o.s, o.l, o.opacity);
      if (!(o instanceof Color)) o = color(o);
      if (!o) return new Hsl;
      if (o instanceof Hsl) return o;
      o = o.rgb();
      var r = o.r / 255,
          g = o.g / 255,
          b = o.b / 255,
          min = Math.min(r, g, b),
          max = Math.max(r, g, b),
          h = NaN,
          s = max - min,
          l = (max + min) / 2;
      if (s) {
        if (r === max) h = (g - b) / s + (g < b) * 6;
        else if (g === max) h = (b - r) / s + 2;
        else h = (r - g) / s + 4;
        s /= l < 0.5 ? max + min : 2 - max - min;
        h *= 60;
      } else {
        s = l > 0 && l < 1 ? 0 : h;
      }
      return new Hsl(h, s, l, o.opacity);
    }

    function hsl(h, s, l, opacity) {
      return arguments.length === 1 ? hslConvert(h) : new Hsl(h, s, l, opacity == null ? 1 : opacity);
    }

    function Hsl(h, s, l, opacity) {
      this.h = +h;
      this.s = +s;
      this.l = +l;
      this.opacity = +opacity;
    }

    define(Hsl, hsl, extend(Color, {
      brighter: function(k) {
        k = k == null ? brighter : Math.pow(brighter, k);
        return new Hsl(this.h, this.s, this.l * k, this.opacity);
      },
      darker: function(k) {
        k = k == null ? darker : Math.pow(darker, k);
        return new Hsl(this.h, this.s, this.l * k, this.opacity);
      },
      rgb: function() {
        var h = this.h % 360 + (this.h < 0) * 360,
            s = isNaN(h) || isNaN(this.s) ? 0 : this.s,
            l = this.l,
            m2 = l + (l < 0.5 ? l : 1 - l) * s,
            m1 = 2 * l - m2;
        return new Rgb(
          hsl2rgb(h >= 240 ? h - 240 : h + 120, m1, m2),
          hsl2rgb(h, m1, m2),
          hsl2rgb(h < 120 ? h + 240 : h - 120, m1, m2),
          this.opacity
        );
      },
      displayable: function() {
        return (0 <= this.s && this.s <= 1 || isNaN(this.s))
            && (0 <= this.l && this.l <= 1)
            && (0 <= this.opacity && this.opacity <= 1);
      },
      formatHsl: function() {
        var a = this.opacity; a = isNaN(a) ? 1 : Math.max(0, Math.min(1, a));
        return (a === 1 ? "hsl(" : "hsla(")
            + (this.h || 0) + ", "
            + (this.s || 0) * 100 + "%, "
            + (this.l || 0) * 100 + "%"
            + (a === 1 ? ")" : ", " + a + ")");
      }
    }));

    /* From FvD 13.37, CSS Color Module Level 3 */
    function hsl2rgb(h, m1, m2) {
      return (h < 60 ? m1 + (m2 - m1) * h / 60
          : h < 180 ? m2
          : h < 240 ? m1 + (m2 - m1) * (240 - h) / 60
          : m1) * 255;
    }

    var constant = x => () => x;

    function linear(a, d) {
      return function(t) {
        return a + t * d;
      };
    }

    function exponential(a, b, y) {
      return a = Math.pow(a, y), b = Math.pow(b, y) - a, y = 1 / y, function(t) {
        return Math.pow(a + t * b, y);
      };
    }

    function gamma(y) {
      return (y = +y) === 1 ? nogamma : function(a, b) {
        return b - a ? exponential(a, b, y) : constant(isNaN(a) ? b : a);
      };
    }

    function nogamma(a, b) {
      var d = b - a;
      return d ? linear(a, d) : constant(isNaN(a) ? b : a);
    }

    var interpolateRgb = (function rgbGamma(y) {
      var color = gamma(y);

      function rgb$1(start, end) {
        var r = color((start = rgb(start)).r, (end = rgb(end)).r),
            g = color(start.g, end.g),
            b = color(start.b, end.b),
            opacity = nogamma(start.opacity, end.opacity);
        return function(t) {
          start.r = r(t);
          start.g = g(t);
          start.b = b(t);
          start.opacity = opacity(t);
          return start + "";
        };
      }

      rgb$1.gamma = rgbGamma;

      return rgb$1;
    })(1);

    function numberArray(a, b) {
      if (!b) b = [];
      var n = a ? Math.min(b.length, a.length) : 0,
          c = b.slice(),
          i;
      return function(t) {
        for (i = 0; i < n; ++i) c[i] = a[i] * (1 - t) + b[i] * t;
        return c;
      };
    }

    function isNumberArray(x) {
      return ArrayBuffer.isView(x) && !(x instanceof DataView);
    }

    function genericArray(a, b) {
      var nb = b ? b.length : 0,
          na = a ? Math.min(nb, a.length) : 0,
          x = new Array(na),
          c = new Array(nb),
          i;

      for (i = 0; i < na; ++i) x[i] = interpolate(a[i], b[i]);
      for (; i < nb; ++i) c[i] = b[i];

      return function(t) {
        for (i = 0; i < na; ++i) c[i] = x[i](t);
        return c;
      };
    }

    function date(a, b) {
      var d = new Date;
      return a = +a, b = +b, function(t) {
        return d.setTime(a * (1 - t) + b * t), d;
      };
    }

    function interpolateNumber(a, b) {
      return a = +a, b = +b, function(t) {
        return a * (1 - t) + b * t;
      };
    }

    function object(a, b) {
      var i = {},
          c = {},
          k;

      if (a === null || typeof a !== "object") a = {};
      if (b === null || typeof b !== "object") b = {};

      for (k in b) {
        if (k in a) {
          i[k] = interpolate(a[k], b[k]);
        } else {
          c[k] = b[k];
        }
      }

      return function(t) {
        for (k in i) c[k] = i[k](t);
        return c;
      };
    }

    var reA = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g,
        reB = new RegExp(reA.source, "g");

    function zero(b) {
      return function() {
        return b;
      };
    }

    function one(b) {
      return function(t) {
        return b(t) + "";
      };
    }

    function interpolateString(a, b) {
      var bi = reA.lastIndex = reB.lastIndex = 0, // scan index for next number in b
          am, // current match in a
          bm, // current match in b
          bs, // string preceding current number in b, if any
          i = -1, // index in s
          s = [], // string constants and placeholders
          q = []; // number interpolators

      // Coerce inputs to strings.
      a = a + "", b = b + "";

      // Interpolate pairs of numbers in a & b.
      while ((am = reA.exec(a))
          && (bm = reB.exec(b))) {
        if ((bs = bm.index) > bi) { // a string precedes the next number in b
          bs = b.slice(bi, bs);
          if (s[i]) s[i] += bs; // coalesce with previous string
          else s[++i] = bs;
        }
        if ((am = am[0]) === (bm = bm[0])) { // numbers in a & b match
          if (s[i]) s[i] += bm; // coalesce with previous string
          else s[++i] = bm;
        } else { // interpolate non-matching numbers
          s[++i] = null;
          q.push({i: i, x: interpolateNumber(am, bm)});
        }
        bi = reB.lastIndex;
      }

      // Add remains of b.
      if (bi < b.length) {
        bs = b.slice(bi);
        if (s[i]) s[i] += bs; // coalesce with previous string
        else s[++i] = bs;
      }

      // Special optimization for only a single match.
      // Otherwise, interpolate each of the numbers and rejoin the string.
      return s.length < 2 ? (q[0]
          ? one(q[0].x)
          : zero(b))
          : (b = q.length, function(t) {
              for (var i = 0, o; i < b; ++i) s[(o = q[i]).i] = o.x(t);
              return s.join("");
            });
    }

    function interpolate(a, b) {
      var t = typeof b, c;
      return b == null || t === "boolean" ? constant(b)
          : (t === "number" ? interpolateNumber
          : t === "string" ? ((c = color(b)) ? (b = c, interpolateRgb) : interpolateString)
          : b instanceof color ? interpolateRgb
          : b instanceof Date ? date
          : isNumberArray(b) ? numberArray
          : Array.isArray(b) ? genericArray
          : typeof b.valueOf !== "function" && typeof b.toString !== "function" || isNaN(b) ? object
          : interpolateNumber)(a, b);
    }

    function interpolateRound(a, b) {
      return a = +a, b = +b, function(t) {
        return Math.round(a * (1 - t) + b * t);
      };
    }

    var emptyOn = dispatch("start", "end", "cancel", "interrupt");

    const pi = Math.PI,
        tau = 2 * pi,
        epsilon = 1e-6,
        tauEpsilon = tau - epsilon;

    function Path() {
      this._x0 = this._y0 = // start of current subpath
      this._x1 = this._y1 = null; // end of current subpath
      this._ = "";
    }

    function path() {
      return new Path;
    }

    Path.prototype = path.prototype = {
      constructor: Path,
      moveTo: function(x, y) {
        this._ += "M" + (this._x0 = this._x1 = +x) + "," + (this._y0 = this._y1 = +y);
      },
      closePath: function() {
        if (this._x1 !== null) {
          this._x1 = this._x0, this._y1 = this._y0;
          this._ += "Z";
        }
      },
      lineTo: function(x, y) {
        this._ += "L" + (this._x1 = +x) + "," + (this._y1 = +y);
      },
      quadraticCurveTo: function(x1, y1, x, y) {
        this._ += "Q" + (+x1) + "," + (+y1) + "," + (this._x1 = +x) + "," + (this._y1 = +y);
      },
      bezierCurveTo: function(x1, y1, x2, y2, x, y) {
        this._ += "C" + (+x1) + "," + (+y1) + "," + (+x2) + "," + (+y2) + "," + (this._x1 = +x) + "," + (this._y1 = +y);
      },
      arcTo: function(x1, y1, x2, y2, r) {
        x1 = +x1, y1 = +y1, x2 = +x2, y2 = +y2, r = +r;
        var x0 = this._x1,
            y0 = this._y1,
            x21 = x2 - x1,
            y21 = y2 - y1,
            x01 = x0 - x1,
            y01 = y0 - y1,
            l01_2 = x01 * x01 + y01 * y01;

        // Is the radius negative? Error.
        if (r < 0) throw new Error("negative radius: " + r);

        // Is this path empty? Move to (x1,y1).
        if (this._x1 === null) {
          this._ += "M" + (this._x1 = x1) + "," + (this._y1 = y1);
        }

        // Or, is (x1,y1) coincident with (x0,y0)? Do nothing.
        else if (!(l01_2 > epsilon));

        // Or, are (x0,y0), (x1,y1) and (x2,y2) collinear?
        // Equivalently, is (x1,y1) coincident with (x2,y2)?
        // Or, is the radius zero? Line to (x1,y1).
        else if (!(Math.abs(y01 * x21 - y21 * x01) > epsilon) || !r) {
          this._ += "L" + (this._x1 = x1) + "," + (this._y1 = y1);
        }

        // Otherwise, draw an arc!
        else {
          var x20 = x2 - x0,
              y20 = y2 - y0,
              l21_2 = x21 * x21 + y21 * y21,
              l20_2 = x20 * x20 + y20 * y20,
              l21 = Math.sqrt(l21_2),
              l01 = Math.sqrt(l01_2),
              l = r * Math.tan((pi - Math.acos((l21_2 + l01_2 - l20_2) / (2 * l21 * l01))) / 2),
              t01 = l / l01,
              t21 = l / l21;

          // If the start tangent is not coincident with (x0,y0), line to.
          if (Math.abs(t01 - 1) > epsilon) {
            this._ += "L" + (x1 + t01 * x01) + "," + (y1 + t01 * y01);
          }

          this._ += "A" + r + "," + r + ",0,0," + (+(y01 * x20 > x01 * y20)) + "," + (this._x1 = x1 + t21 * x21) + "," + (this._y1 = y1 + t21 * y21);
        }
      },
      arc: function(x, y, r, a0, a1, ccw) {
        x = +x, y = +y, r = +r, ccw = !!ccw;
        var dx = r * Math.cos(a0),
            dy = r * Math.sin(a0),
            x0 = x + dx,
            y0 = y + dy,
            cw = 1 ^ ccw,
            da = ccw ? a0 - a1 : a1 - a0;

        // Is the radius negative? Error.
        if (r < 0) throw new Error("negative radius: " + r);

        // Is this path empty? Move to (x0,y0).
        if (this._x1 === null) {
          this._ += "M" + x0 + "," + y0;
        }

        // Or, is (x0,y0) not coincident with the previous point? Line to (x0,y0).
        else if (Math.abs(this._x1 - x0) > epsilon || Math.abs(this._y1 - y0) > epsilon) {
          this._ += "L" + x0 + "," + y0;
        }

        // Is this arc empty? We’re done.
        if (!r) return;

        // Does the angle go the wrong way? Flip the direction.
        if (da < 0) da = da % tau + tau;

        // Is this a complete circle? Draw two arcs to complete the circle.
        if (da > tauEpsilon) {
          this._ += "A" + r + "," + r + ",0,1," + cw + "," + (x - dx) + "," + (y - dy) + "A" + r + "," + r + ",0,1," + cw + "," + (this._x1 = x0) + "," + (this._y1 = y0);
        }

        // Is this arc non-empty? Draw an arc!
        else if (da > epsilon) {
          this._ += "A" + r + "," + r + ",0," + (+(da >= pi)) + "," + cw + "," + (this._x1 = x + r * Math.cos(a1)) + "," + (this._y1 = y + r * Math.sin(a1));
        }
      },
      rect: function(x, y, w, h) {
        this._ += "M" + (this._x0 = this._x1 = +x) + "," + (this._y0 = this._y1 = +y) + "h" + (+w) + "v" + (+h) + "h" + (-w) + "Z";
      },
      toString: function() {
        return this._;
      }
    };

    function formatDecimal(x) {
      return Math.abs(x = Math.round(x)) >= 1e21
          ? x.toLocaleString("en").replace(/,/g, "")
          : x.toString(10);
    }

    // Computes the decimal coefficient and exponent of the specified number x with
    // significant digits p, where x is positive and p is in [1, 21] or undefined.
    // For example, formatDecimalParts(1.23) returns ["123", 0].
    function formatDecimalParts(x, p) {
      if ((i = (x = p ? x.toExponential(p - 1) : x.toExponential()).indexOf("e")) < 0) return null; // NaN, ±Infinity
      var i, coefficient = x.slice(0, i);

      // The string returned by toExponential either has the form \d\.\d+e[-+]\d+
      // (e.g., 1.2e+3) or the form \de[-+]\d+ (e.g., 1e+3).
      return [
        coefficient.length > 1 ? coefficient[0] + coefficient.slice(2) : coefficient,
        +x.slice(i + 1)
      ];
    }

    function exponent(x) {
      return x = formatDecimalParts(Math.abs(x)), x ? x[1] : NaN;
    }

    function formatGroup(grouping, thousands) {
      return function(value, width) {
        var i = value.length,
            t = [],
            j = 0,
            g = grouping[0],
            length = 0;

        while (i > 0 && g > 0) {
          if (length + g + 1 > width) g = Math.max(1, width - length);
          t.push(value.substring(i -= g, i + g));
          if ((length += g + 1) > width) break;
          g = grouping[j = (j + 1) % grouping.length];
        }

        return t.reverse().join(thousands);
      };
    }

    function formatNumerals(numerals) {
      return function(value) {
        return value.replace(/[0-9]/g, function(i) {
          return numerals[+i];
        });
      };
    }

    // [[fill]align][sign][symbol][0][width][,][.precision][~][type]
    var re = /^(?:(.)?([<>=^]))?([+\-( ])?([$#])?(0)?(\d+)?(,)?(\.\d+)?(~)?([a-z%])?$/i;

    function formatSpecifier(specifier) {
      if (!(match = re.exec(specifier))) throw new Error("invalid format: " + specifier);
      var match;
      return new FormatSpecifier({
        fill: match[1],
        align: match[2],
        sign: match[3],
        symbol: match[4],
        zero: match[5],
        width: match[6],
        comma: match[7],
        precision: match[8] && match[8].slice(1),
        trim: match[9],
        type: match[10]
      });
    }

    formatSpecifier.prototype = FormatSpecifier.prototype; // instanceof

    function FormatSpecifier(specifier) {
      this.fill = specifier.fill === undefined ? " " : specifier.fill + "";
      this.align = specifier.align === undefined ? ">" : specifier.align + "";
      this.sign = specifier.sign === undefined ? "-" : specifier.sign + "";
      this.symbol = specifier.symbol === undefined ? "" : specifier.symbol + "";
      this.zero = !!specifier.zero;
      this.width = specifier.width === undefined ? undefined : +specifier.width;
      this.comma = !!specifier.comma;
      this.precision = specifier.precision === undefined ? undefined : +specifier.precision;
      this.trim = !!specifier.trim;
      this.type = specifier.type === undefined ? "" : specifier.type + "";
    }

    FormatSpecifier.prototype.toString = function() {
      return this.fill
          + this.align
          + this.sign
          + this.symbol
          + (this.zero ? "0" : "")
          + (this.width === undefined ? "" : Math.max(1, this.width | 0))
          + (this.comma ? "," : "")
          + (this.precision === undefined ? "" : "." + Math.max(0, this.precision | 0))
          + (this.trim ? "~" : "")
          + this.type;
    };

    // Trims insignificant zeros, e.g., replaces 1.2000k with 1.2k.
    function formatTrim(s) {
      out: for (var n = s.length, i = 1, i0 = -1, i1; i < n; ++i) {
        switch (s[i]) {
          case ".": i0 = i1 = i; break;
          case "0": if (i0 === 0) i0 = i; i1 = i; break;
          default: if (!+s[i]) break out; if (i0 > 0) i0 = 0; break;
        }
      }
      return i0 > 0 ? s.slice(0, i0) + s.slice(i1 + 1) : s;
    }

    var prefixExponent;

    function formatPrefixAuto(x, p) {
      var d = formatDecimalParts(x, p);
      if (!d) return x + "";
      var coefficient = d[0],
          exponent = d[1],
          i = exponent - (prefixExponent = Math.max(-8, Math.min(8, Math.floor(exponent / 3))) * 3) + 1,
          n = coefficient.length;
      return i === n ? coefficient
          : i > n ? coefficient + new Array(i - n + 1).join("0")
          : i > 0 ? coefficient.slice(0, i) + "." + coefficient.slice(i)
          : "0." + new Array(1 - i).join("0") + formatDecimalParts(x, Math.max(0, p + i - 1))[0]; // less than 1y!
    }

    function formatRounded(x, p) {
      var d = formatDecimalParts(x, p);
      if (!d) return x + "";
      var coefficient = d[0],
          exponent = d[1];
      return exponent < 0 ? "0." + new Array(-exponent).join("0") + coefficient
          : coefficient.length > exponent + 1 ? coefficient.slice(0, exponent + 1) + "." + coefficient.slice(exponent + 1)
          : coefficient + new Array(exponent - coefficient.length + 2).join("0");
    }

    var formatTypes = {
      "%": (x, p) => (x * 100).toFixed(p),
      "b": (x) => Math.round(x).toString(2),
      "c": (x) => x + "",
      "d": formatDecimal,
      "e": (x, p) => x.toExponential(p),
      "f": (x, p) => x.toFixed(p),
      "g": (x, p) => x.toPrecision(p),
      "o": (x) => Math.round(x).toString(8),
      "p": (x, p) => formatRounded(x * 100, p),
      "r": formatRounded,
      "s": formatPrefixAuto,
      "X": (x) => Math.round(x).toString(16).toUpperCase(),
      "x": (x) => Math.round(x).toString(16)
    };

    function identity(x) {
      return x;
    }

    var map = Array.prototype.map,
        prefixes = ["y","z","a","f","p","n","µ","m","","k","M","G","T","P","E","Z","Y"];

    function formatLocale(locale) {
      var group = locale.grouping === undefined || locale.thousands === undefined ? identity : formatGroup(map.call(locale.grouping, Number), locale.thousands + ""),
          currencyPrefix = locale.currency === undefined ? "" : locale.currency[0] + "",
          currencySuffix = locale.currency === undefined ? "" : locale.currency[1] + "",
          decimal = locale.decimal === undefined ? "." : locale.decimal + "",
          numerals = locale.numerals === undefined ? identity : formatNumerals(map.call(locale.numerals, String)),
          percent = locale.percent === undefined ? "%" : locale.percent + "",
          minus = locale.minus === undefined ? "−" : locale.minus + "",
          nan = locale.nan === undefined ? "NaN" : locale.nan + "";

      function newFormat(specifier) {
        specifier = formatSpecifier(specifier);

        var fill = specifier.fill,
            align = specifier.align,
            sign = specifier.sign,
            symbol = specifier.symbol,
            zero = specifier.zero,
            width = specifier.width,
            comma = specifier.comma,
            precision = specifier.precision,
            trim = specifier.trim,
            type = specifier.type;

        // The "n" type is an alias for ",g".
        if (type === "n") comma = true, type = "g";

        // The "" type, and any invalid type, is an alias for ".12~g".
        else if (!formatTypes[type]) precision === undefined && (precision = 12), trim = true, type = "g";

        // If zero fill is specified, padding goes after sign and before digits.
        if (zero || (fill === "0" && align === "=")) zero = true, fill = "0", align = "=";

        // Compute the prefix and suffix.
        // For SI-prefix, the suffix is lazily computed.
        var prefix = symbol === "$" ? currencyPrefix : symbol === "#" && /[boxX]/.test(type) ? "0" + type.toLowerCase() : "",
            suffix = symbol === "$" ? currencySuffix : /[%p]/.test(type) ? percent : "";

        // What format function should we use?
        // Is this an integer type?
        // Can this type generate exponential notation?
        var formatType = formatTypes[type],
            maybeSuffix = /[defgprs%]/.test(type);

        // Set the default precision if not specified,
        // or clamp the specified precision to the supported range.
        // For significant precision, it must be in [1, 21].
        // For fixed precision, it must be in [0, 20].
        precision = precision === undefined ? 6
            : /[gprs]/.test(type) ? Math.max(1, Math.min(21, precision))
            : Math.max(0, Math.min(20, precision));

        function format(value) {
          var valuePrefix = prefix,
              valueSuffix = suffix,
              i, n, c;

          if (type === "c") {
            valueSuffix = formatType(value) + valueSuffix;
            value = "";
          } else {
            value = +value;

            // Determine the sign. -0 is not less than 0, but 1 / -0 is!
            var valueNegative = value < 0 || 1 / value < 0;

            // Perform the initial formatting.
            value = isNaN(value) ? nan : formatType(Math.abs(value), precision);

            // Trim insignificant zeros.
            if (trim) value = formatTrim(value);

            // If a negative value rounds to zero after formatting, and no explicit positive sign is requested, hide the sign.
            if (valueNegative && +value === 0 && sign !== "+") valueNegative = false;

            // Compute the prefix and suffix.
            valuePrefix = (valueNegative ? (sign === "(" ? sign : minus) : sign === "-" || sign === "(" ? "" : sign) + valuePrefix;
            valueSuffix = (type === "s" ? prefixes[8 + prefixExponent / 3] : "") + valueSuffix + (valueNegative && sign === "(" ? ")" : "");

            // Break the formatted value into the integer “value” part that can be
            // grouped, and fractional or exponential “suffix” part that is not.
            if (maybeSuffix) {
              i = -1, n = value.length;
              while (++i < n) {
                if (c = value.charCodeAt(i), 48 > c || c > 57) {
                  valueSuffix = (c === 46 ? decimal + value.slice(i + 1) : value.slice(i)) + valueSuffix;
                  value = value.slice(0, i);
                  break;
                }
              }
            }
          }

          // If the fill character is not "0", grouping is applied before padding.
          if (comma && !zero) value = group(value, Infinity);

          // Compute the padding.
          var length = valuePrefix.length + value.length + valueSuffix.length,
              padding = length < width ? new Array(width - length + 1).join(fill) : "";

          // If the fill character is "0", grouping is applied after padding.
          if (comma && zero) value = group(padding + value, padding.length ? width - valueSuffix.length : Infinity), padding = "";

          // Reconstruct the final output based on the desired alignment.
          switch (align) {
            case "<": value = valuePrefix + value + valueSuffix + padding; break;
            case "=": value = valuePrefix + padding + value + valueSuffix; break;
            case "^": value = padding.slice(0, length = padding.length >> 1) + valuePrefix + value + valueSuffix + padding.slice(length); break;
            default: value = padding + valuePrefix + value + valueSuffix; break;
          }

          return numerals(value);
        }

        format.toString = function() {
          return specifier + "";
        };

        return format;
      }

      function formatPrefix(specifier, value) {
        var f = newFormat((specifier = formatSpecifier(specifier), specifier.type = "f", specifier)),
            e = Math.max(-8, Math.min(8, Math.floor(exponent(value) / 3))) * 3,
            k = Math.pow(10, -e),
            prefix = prefixes[8 + e / 3];
        return function(value) {
          return f(k * value) + prefix;
        };
      }

      return {
        format: newFormat,
        formatPrefix: formatPrefix
      };
    }

    var locale;
    var format;
    var formatPrefix;

    defaultLocale({
      thousands: ",",
      grouping: [3],
      currency: ["$", ""]
    });

    function defaultLocale(definition) {
      locale = formatLocale(definition);
      format = locale.format;
      formatPrefix = locale.formatPrefix;
      return locale;
    }

    function precisionFixed(step) {
      return Math.max(0, -exponent(Math.abs(step)));
    }

    function precisionPrefix(step, value) {
      return Math.max(0, Math.max(-8, Math.min(8, Math.floor(exponent(value) / 3))) * 3 - exponent(Math.abs(step)));
    }

    function precisionRound(step, max) {
      step = Math.abs(step), max = Math.abs(max) - step;
      return Math.max(0, exponent(max) - exponent(step)) + 1;
    }

    function initRange(domain, range) {
      switch (arguments.length) {
        case 0: break;
        case 1: this.range(domain); break;
        default: this.range(range).domain(domain); break;
      }
      return this;
    }

    function constant$1(x) {
      return function() {
        return x;
      };
    }

    function number$1(x) {
      return +x;
    }

    var unit = [0, 1];

    function identity$1(x) {
      return x;
    }

    function normalize(a, b) {
      return (b -= (a = +a))
          ? function(x) { return (x - a) / b; }
          : constant$1(isNaN(b) ? NaN : 0.5);
    }

    function clamper(a, b) {
      var t;
      if (a > b) t = a, a = b, b = t;
      return function(x) { return Math.max(a, Math.min(b, x)); };
    }

    // normalize(a, b)(x) takes a domain value x in [a,b] and returns the corresponding parameter t in [0,1].
    // interpolate(a, b)(t) takes a parameter t in [0,1] and returns the corresponding range value x in [a,b].
    function bimap(domain, range, interpolate) {
      var d0 = domain[0], d1 = domain[1], r0 = range[0], r1 = range[1];
      if (d1 < d0) d0 = normalize(d1, d0), r0 = interpolate(r1, r0);
      else d0 = normalize(d0, d1), r0 = interpolate(r0, r1);
      return function(x) { return r0(d0(x)); };
    }

    function polymap(domain, range, interpolate) {
      var j = Math.min(domain.length, range.length) - 1,
          d = new Array(j),
          r = new Array(j),
          i = -1;

      // Reverse descending domains.
      if (domain[j] < domain[0]) {
        domain = domain.slice().reverse();
        range = range.slice().reverse();
      }

      while (++i < j) {
        d[i] = normalize(domain[i], domain[i + 1]);
        r[i] = interpolate(range[i], range[i + 1]);
      }

      return function(x) {
        var i = bisectRight(domain, x, 1, j) - 1;
        return r[i](d[i](x));
      };
    }

    function copy(source, target) {
      return target
          .domain(source.domain())
          .range(source.range())
          .interpolate(source.interpolate())
          .clamp(source.clamp())
          .unknown(source.unknown());
    }

    function transformer() {
      var domain = unit,
          range = unit,
          interpolate$1 = interpolate,
          transform,
          untransform,
          unknown,
          clamp = identity$1,
          piecewise,
          output,
          input;

      function rescale() {
        var n = Math.min(domain.length, range.length);
        if (clamp !== identity$1) clamp = clamper(domain[0], domain[n - 1]);
        piecewise = n > 2 ? polymap : bimap;
        output = input = null;
        return scale;
      }

      function scale(x) {
        return isNaN(x = +x) ? unknown : (output || (output = piecewise(domain.map(transform), range, interpolate$1)))(transform(clamp(x)));
      }

      scale.invert = function(y) {
        return clamp(untransform((input || (input = piecewise(range, domain.map(transform), interpolateNumber)))(y)));
      };

      scale.domain = function(_) {
        return arguments.length ? (domain = Array.from(_, number$1), rescale()) : domain.slice();
      };

      scale.range = function(_) {
        return arguments.length ? (range = Array.from(_), rescale()) : range.slice();
      };

      scale.rangeRound = function(_) {
        return range = Array.from(_), interpolate$1 = interpolateRound, rescale();
      };

      scale.clamp = function(_) {
        return arguments.length ? (clamp = _ ? true : identity$1, rescale()) : clamp !== identity$1;
      };

      scale.interpolate = function(_) {
        return arguments.length ? (interpolate$1 = _, rescale()) : interpolate$1;
      };

      scale.unknown = function(_) {
        return arguments.length ? (unknown = _, scale) : unknown;
      };

      return function(t, u) {
        transform = t, untransform = u;
        return rescale();
      };
    }

    function continuous() {
      return transformer()(identity$1, identity$1);
    }

    function tickFormat(start, stop, count, specifier) {
      var step = tickStep(start, stop, count),
          precision;
      specifier = formatSpecifier(specifier == null ? ",f" : specifier);
      switch (specifier.type) {
        case "s": {
          var value = Math.max(Math.abs(start), Math.abs(stop));
          if (specifier.precision == null && !isNaN(precision = precisionPrefix(step, value))) specifier.precision = precision;
          return formatPrefix(specifier, value);
        }
        case "":
        case "e":
        case "g":
        case "p":
        case "r": {
          if (specifier.precision == null && !isNaN(precision = precisionRound(step, Math.max(Math.abs(start), Math.abs(stop))))) specifier.precision = precision - (specifier.type === "e");
          break;
        }
        case "f":
        case "%": {
          if (specifier.precision == null && !isNaN(precision = precisionFixed(step))) specifier.precision = precision - (specifier.type === "%") * 2;
          break;
        }
      }
      return format(specifier);
    }

    function linearish(scale) {
      var domain = scale.domain;

      scale.ticks = function(count) {
        var d = domain();
        return ticks(d[0], d[d.length - 1], count == null ? 10 : count);
      };

      scale.tickFormat = function(count, specifier) {
        var d = domain();
        return tickFormat(d[0], d[d.length - 1], count == null ? 10 : count, specifier);
      };

      scale.nice = function(count) {
        if (count == null) count = 10;

        var d = domain();
        var i0 = 0;
        var i1 = d.length - 1;
        var start = d[i0];
        var stop = d[i1];
        var prestep;
        var step;
        var maxIter = 10;

        if (stop < start) {
          step = start, start = stop, stop = step;
          step = i0, i0 = i1, i1 = step;
        }
        
        while (maxIter-- > 0) {
          step = tickIncrement(start, stop, count);
          if (step === prestep) {
            d[i0] = start;
            d[i1] = stop;
            return domain(d);
          } else if (step > 0) {
            start = Math.floor(start / step) * step;
            stop = Math.ceil(stop / step) * step;
          } else if (step < 0) {
            start = Math.ceil(start * step) / step;
            stop = Math.floor(stop * step) / step;
          } else {
            break;
          }
          prestep = step;
        }

        return scale;
      };

      return scale;
    }

    function linear$1() {
      var scale = continuous();

      scale.copy = function() {
        return copy(scale, linear$1());
      };

      initRange.apply(scale, arguments);

      return linearish(scale);
    }

    function constant$2(x) {
      return function constant() {
        return x;
      };
    }

    var slice = Array.prototype.slice;

    function x(p) {
      return p[0];
    }

    function y(p) {
      return p[1];
    }

    function linkSource(d) {
      return d.source;
    }

    function linkTarget(d) {
      return d.target;
    }

    function link(curve) {
      var source = linkSource,
          target = linkTarget,
          x$1 = x,
          y$1 = y,
          context = null;

      function link() {
        var buffer, argv = slice.call(arguments), s = source.apply(this, argv), t = target.apply(this, argv);
        if (!context) context = buffer = path();
        curve(context, +x$1.apply(this, (argv[0] = s, argv)), +y$1.apply(this, argv), +x$1.apply(this, (argv[0] = t, argv)), +y$1.apply(this, argv));
        if (buffer) return context = null, buffer + "" || null;
      }

      link.source = function(_) {
        return arguments.length ? (source = _, link) : source;
      };

      link.target = function(_) {
        return arguments.length ? (target = _, link) : target;
      };

      link.x = function(_) {
        return arguments.length ? (x$1 = typeof _ === "function" ? _ : constant$2(+_), link) : x$1;
      };

      link.y = function(_) {
        return arguments.length ? (y$1 = typeof _ === "function" ? _ : constant$2(+_), link) : y$1;
      };

      link.context = function(_) {
        return arguments.length ? ((context = _ == null ? null : _), link) : context;
      };

      return link;
    }

    function curveVertical(context, x0, y0, x1, y1) {
      context.moveTo(x0, y0);
      context.bezierCurveTo(x0, y0 = (y0 + y1) / 2, x1, y0, x1, y1);
    }

    function linkVertical() {
      return link(curveVertical);
    }

    /* src/components/TokenRow.svelte generated by Svelte v3.24.1 */

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[22] = list[i];
    	child_ctx[24] = i;
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[22] = list[i];
    	child_ctx[25] = list;
    	child_ctx[24] = i;
    	return child_ctx;
    }

    // (66:2) {#each tokens as token, i}
    function create_each_block_1(ctx) {
    	let text_1;
    	let t_value = /*token*/ ctx[22] + "";
    	let t;
    	let text_1_font_size_value;
    	let i = /*i*/ ctx[24];
    	const assign_text_1 = () => /*text_1_binding*/ ctx[16](text_1, i);
    	const unassign_text_1 = () => /*text_1_binding*/ ctx[16](null, i);

    	return {
    		c() {
    			text_1 = svg_element("text");
    			t = text(t_value);
    			attr(text_1, "y", /*fontSize*/ ctx[2]);
    			attr(text_1, "font-size", text_1_font_size_value = "" + (/*fontSize*/ ctx[2] + "px"));
    		},
    		m(target, anchor) {
    			insert(target, text_1, anchor);
    			append(text_1, t);
    			assign_text_1();
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty & /*tokens*/ 2 && t_value !== (t_value = /*token*/ ctx[22] + "")) set_data(t, t_value);

    			if (dirty & /*fontSize*/ 4) {
    				attr(text_1, "y", /*fontSize*/ ctx[2]);
    			}

    			if (dirty & /*fontSize*/ 4 && text_1_font_size_value !== (text_1_font_size_value = "" + (/*fontSize*/ ctx[2] + "px"))) {
    				attr(text_1, "font-size", text_1_font_size_value);
    			}

    			if (i !== /*i*/ ctx[24]) {
    				unassign_text_1();
    				i = /*i*/ ctx[24];
    				assign_text_1();
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(text_1);
    			unassign_text_1();
    		}
    	};
    }

    // (75:2) {#each tokens as token, i}
    function create_each_block(ctx) {
    	let text_1;
    	let t_value = /*token*/ ctx[22] + "";
    	let t;
    	let text_1_x_value;
    	let text_1_font_size_value;
    	let mounted;
    	let dispose;

    	function click_handler(...args) {
    		return /*click_handler*/ ctx[17](/*token*/ ctx[22], /*i*/ ctx[24], ...args);
    	}

    	function mouseover_handler(...args) {
    		return /*mouseover_handler*/ ctx[18](/*i*/ ctx[24], /*token*/ ctx[22], ...args);
    	}

    	function mouseout_handler(...args) {
    		return /*mouseout_handler*/ ctx[19](/*token*/ ctx[22], /*i*/ ctx[24], ...args);
    	}

    	return {
    		c() {
    			text_1 = svg_element("text");
    			t = text(t_value);
    			attr(text_1, "x", text_1_x_value = /*startXs*/ ctx[7][/*i*/ ctx[24]]);
    			attr(text_1, "y", /*startY*/ ctx[0]);
    			attr(text_1, "font-size", text_1_font_size_value = "" + (/*fontSize*/ ctx[2] + "px"));
    			attr(text_1, "alignment-baseline", /*alignment*/ ctx[3]);
    			toggle_class(text_1, "hovered", /*hoveredInd*/ ctx[5] == /*i*/ ctx[24]);
    			toggle_class(text_1, "selected", /*selectedInd*/ ctx[4] == /*i*/ ctx[24]);
    		},
    		m(target, anchor) {
    			insert(target, text_1, anchor);
    			append(text_1, t);

    			if (!mounted) {
    				dispose = [
    					listen(text_1, "click", click_handler),
    					listen(text_1, "mouseover", mouseover_handler),
    					listen(text_1, "mouseout", mouseout_handler)
    				];

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty & /*tokens*/ 2 && t_value !== (t_value = /*token*/ ctx[22] + "")) set_data(t, t_value);

    			if (dirty & /*startXs*/ 128 && text_1_x_value !== (text_1_x_value = /*startXs*/ ctx[7][/*i*/ ctx[24]])) {
    				attr(text_1, "x", text_1_x_value);
    			}

    			if (dirty & /*startY*/ 1) {
    				attr(text_1, "y", /*startY*/ ctx[0]);
    			}

    			if (dirty & /*fontSize*/ 4 && text_1_font_size_value !== (text_1_font_size_value = "" + (/*fontSize*/ ctx[2] + "px"))) {
    				attr(text_1, "font-size", text_1_font_size_value);
    			}

    			if (dirty & /*alignment*/ 8) {
    				attr(text_1, "alignment-baseline", /*alignment*/ ctx[3]);
    			}

    			if (dirty & /*hoveredInd*/ 32) {
    				toggle_class(text_1, "hovered", /*hoveredInd*/ ctx[5] == /*i*/ ctx[24]);
    			}

    			if (dirty & /*selectedInd*/ 16) {
    				toggle_class(text_1, "selected", /*selectedInd*/ ctx[4] == /*i*/ ctx[24]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(text_1);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let g0;
    	let g0_transform_value;
    	let t;
    	let g1;
    	let each_value_1 = /*tokens*/ ctx[1];
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks_1[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	let each_value = /*tokens*/ ctx[1];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	return {
    		c() {
    			g0 = svg_element("g");

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t = space();
    			g1 = svg_element("g");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			this.c = noop;
    			attr(g0, "transform", g0_transform_value = "translate(" + /*offscreenX*/ ctx[9] + " 0)");
    		},
    		m(target, anchor) {
    			insert(target, g0, anchor);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(g0, null);
    			}

    			insert(target, t, anchor);
    			insert(target, g1, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(g1, null);
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*fontSize, dummyTokens, tokens*/ 70) {
    				each_value_1 = /*tokens*/ ctx[1];
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_1[i] = create_each_block_1(child_ctx);
    						each_blocks_1[i].c();
    						each_blocks_1[i].m(g0, null);
    					}
    				}

    				for (; i < each_blocks_1.length; i += 1) {
    					each_blocks_1[i].d(1);
    				}

    				each_blocks_1.length = each_value_1.length;
    			}

    			if (dirty & /*startXs, startY, fontSize, alignment, hoveredInd, selectedInd, dispatch, tokens*/ 447) {
    				each_value = /*tokens*/ ctx[1];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(g1, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(g0);
    			destroy_each(each_blocks_1, detaching);
    			if (detaching) detach(t);
    			if (detaching) detach(g1);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    function initial(arr) {
    	var length = arr == null ? 0 : arr.length;
    	return length ? arr.slice(0, -1) : [];
    }

    function last(array) {
    	var length = array == null ? 0 : array.length;
    	return length ? array[length - 1] : undefined;
    }

    function max$1(arr) {
    	return arr.reduce((acc, x) => x > acc ? x : acc, Number.NEGATIVE_INFINITY);
    }

    function instance($$self, $$props, $$invalidate) {
    	const dispatch = createEventDispatcher();
    	const offscreenX = -10000;
    	let { tokens = [] } = $$props;
    	let { fontSize = 22 } = $$props;
    	let { tokenSpacing = 5 } = $$props;
    	let { startY = null } = $$props;
    	let { alignment = "baseline" } = $$props;
    	let { selectedInd = null } = $$props;
    	let hoveredInd = null;

    	// Smart defaults
    	if (startY == null) {
    		startY = alignment == "baseline" ? fontSize : 0;
    	}

    	// Measure widths offscreen
    	let dummyTokens = [];

    	let widths = tokens.map(t => 10);
    	let startXs = widths;

    	function widths2startXs(widths) {
    		return initial(widths.reduce((acc, w) => [...acc, tokenSpacing + last(acc) + w], [0]));
    	}

    	function midpoints() {
    		return zip(startXs, widths).map(info => {
    			return info[0] + info[1] / 2;
    		});
    	}

    	function totalWidth() {
    		return sum(widths) + tokenSpacing * (tokens.length - 1);
    	}

    	onMount(() => {
    		widths = dummyTokens.map(t => t.getBoundingClientRect().width);
    		$$invalidate(7, startXs = widths2startXs(widths));
    		console.log("Token widths: ", widths);
    		console.log("Token startXs: ", startXs);
    	});

    	function text_1_binding($$value, i) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			dummyTokens[i] = $$value;
    			$$invalidate(6, dummyTokens);
    		});
    	}

    	const click_handler = (token, i) => {
    		dispatch("click", { token, idx: i });
    	};

    	const mouseover_handler = (i, token) => {
    		$$invalidate(5, hoveredInd = i);
    		dispatch("mouseover", { token, idx: i });
    	};

    	const mouseout_handler = (token, i) => {
    		$$invalidate(5, hoveredInd = null);
    		dispatch("mouseover", { token, idx: i });
    	};

    	$$self.$$set = $$props => {
    		if ("tokens" in $$props) $$invalidate(1, tokens = $$props.tokens);
    		if ("fontSize" in $$props) $$invalidate(2, fontSize = $$props.fontSize);
    		if ("tokenSpacing" in $$props) $$invalidate(13, tokenSpacing = $$props.tokenSpacing);
    		if ("startY" in $$props) $$invalidate(0, startY = $$props.startY);
    		if ("alignment" in $$props) $$invalidate(3, alignment = $$props.alignment);
    		if ("selectedInd" in $$props) $$invalidate(4, selectedInd = $$props.selectedInd);
    	};

    	return [
    		startY,
    		tokens,
    		fontSize,
    		alignment,
    		selectedInd,
    		hoveredInd,
    		dummyTokens,
    		startXs,
    		dispatch,
    		offscreenX,
    		initial,
    		last,
    		max$1,
    		tokenSpacing,
    		midpoints,
    		totalWidth,
    		text_1_binding,
    		click_handler,
    		mouseover_handler,
    		mouseout_handler
    	];
    }

    class TokenRow extends SvelteElement {
    	constructor(options) {
    		super();
    		this.shadowRoot.innerHTML = `<style>.hovered{fill:red}.selected{fill:blue}</style>`;

    		init(this, { target: this.shadowRoot }, instance, create_fragment, safe_not_equal, {
    			initial: 10,
    			last: 11,
    			max: 12,
    			tokens: 1,
    			fontSize: 2,
    			tokenSpacing: 13,
    			startY: 0,
    			alignment: 3,
    			selectedInd: 4,
    			midpoints: 14,
    			totalWidth: 15
    		});

    		if (options) {
    			if (options.target) {
    				insert(options.target, this, options.anchor);
    			}

    			if (options.props) {
    				this.$set(options.props);
    				flush();
    			}
    		}
    	}

    	static get observedAttributes() {
    		return [
    			"initial",
    			"last",
    			"max",
    			"tokens",
    			"fontSize",
    			"tokenSpacing",
    			"startY",
    			"alignment",
    			"selectedInd",
    			"midpoints",
    			"totalWidth"
    		];
    	}

    	get initial() {
    		return initial;
    	}

    	get last() {
    		return last;
    	}

    	get max() {
    		return max$1;
    	}

    	get tokens() {
    		return this.$$.ctx[1];
    	}

    	set tokens(tokens) {
    		this.$set({ tokens });
    		flush();
    	}

    	get fontSize() {
    		return this.$$.ctx[2];
    	}

    	set fontSize(fontSize) {
    		this.$set({ fontSize });
    		flush();
    	}

    	get tokenSpacing() {
    		return this.$$.ctx[13];
    	}

    	set tokenSpacing(tokenSpacing) {
    		this.$set({ tokenSpacing });
    		flush();
    	}

    	get startY() {
    		return this.$$.ctx[0];
    	}

    	set startY(startY) {
    		this.$set({ startY });
    		flush();
    	}

    	get alignment() {
    		return this.$$.ctx[3];
    	}

    	set alignment(alignment) {
    		this.$set({ alignment });
    		flush();
    	}

    	get selectedInd() {
    		return this.$$.ctx[4];
    	}

    	set selectedInd(selectedInd) {
    		this.$set({ selectedInd });
    		flush();
    	}

    	get midpoints() {
    		return this.$$.ctx[14];
    	}

    	get totalWidth() {
    		return this.$$.ctx[15];
    	}
    }

    customElements.define("token-row", TokenRow);

    /* src/components/AttentionConnector.svelte generated by Svelte v3.24.1 */

    function get_each_context_1$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[23] = list[i];
    	child_ctx[25] = i;
    	return child_ctx;
    }

    function get_each_context$1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[20] = list[i];
    	child_ctx[22] = i;
    	return child_ctx;
    }

    // (88:4) {#each srcRow as att, j}
    function create_each_block_1$1(ctx) {
    	let path;
    	let path_d_value;
    	let path_stroke_width_value;
    	let path_opacity_value;

    	return {
    		c() {
    			path = svg_element("path");
    			attr(path, "d", path_d_value = /*linkGen*/ ctx[4](/*att*/ ctx[23]));
    			attr(path, "class", "att-connection");
    			attr(path, "stroke-width", path_stroke_width_value = /*widthScale*/ ctx[2](/*opacityScale*/ ctx[1](/*att*/ ctx[23].att)));
    			attr(path, "opacity", path_opacity_value = /*opacityScale*/ ctx[1](/*att*/ ctx[23].att));
    			toggle_class(path, "inactive", /*isInactive*/ ctx[3](/*i*/ ctx[22], /*j*/ ctx[25]));
    		},
    		m(target, anchor) {
    			insert(target, path, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*attLinks*/ 1 && path_d_value !== (path_d_value = /*linkGen*/ ctx[4](/*att*/ ctx[23]))) {
    				attr(path, "d", path_d_value);
    			}

    			if (dirty & /*widthScale, opacityScale, attLinks*/ 7 && path_stroke_width_value !== (path_stroke_width_value = /*widthScale*/ ctx[2](/*opacityScale*/ ctx[1](/*att*/ ctx[23].att)))) {
    				attr(path, "stroke-width", path_stroke_width_value);
    			}

    			if (dirty & /*opacityScale, attLinks*/ 3 && path_opacity_value !== (path_opacity_value = /*opacityScale*/ ctx[1](/*att*/ ctx[23].att))) {
    				attr(path, "opacity", path_opacity_value);
    			}

    			if (dirty & /*isInactive*/ 8) {
    				toggle_class(path, "inactive", /*isInactive*/ ctx[3](/*i*/ ctx[22], /*j*/ ctx[25]));
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(path);
    		}
    	};
    }

    // (87:2) {#each attLinks as srcRow, i}
    function create_each_block$1(ctx) {
    	let each_1_anchor;
    	let each_value_1 = /*srcRow*/ ctx[20];
    	let each_blocks = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks[i] = create_each_block_1$1(get_each_context_1$1(ctx, each_value_1, i));
    	}

    	return {
    		c() {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			each_1_anchor = empty();
    		},
    		m(target, anchor) {
    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(target, anchor);
    			}

    			insert(target, each_1_anchor, anchor);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*linkGen, attLinks, widthScale, opacityScale, isInactive*/ 31) {
    				each_value_1 = /*srcRow*/ ctx[20];
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1$1(ctx, each_value_1, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_1$1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_1.length;
    			}
    		},
    		d(detaching) {
    			destroy_each(each_blocks, detaching);
    			if (detaching) detach(each_1_anchor);
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	let g;
    	let each_value = /*attLinks*/ ctx[0];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block$1(get_each_context$1(ctx, each_value, i));
    	}

    	return {
    		c() {
    			g = svg_element("g");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			this.c = noop;
    		},
    		m(target, anchor) {
    			insert(target, g, anchor);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(g, null);
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*attLinks, linkGen, widthScale, opacityScale, isInactive*/ 31) {
    				each_value = /*attLinks*/ ctx[0];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context$1(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block$1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(g, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(g);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    function initial$1(arr) {
    	var length = arr == null ? 0 : arr.length;
    	return length ? arr.slice(0, -1) : [];
    }

    function last$1(array) {
    	var length = array == null ? 0 : array.length;
    	return length ? array[length - 1] : undefined;
    }

    function max$2(arr) {
    	return arr.reduce((acc, x) => x > acc ? x : acc, Number.NEGATIVE_INFINITY);
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { attentions = [[]] } = $$props;
    	let { attHeight = 180 } = $$props;
    	let { srcPoints = null } = $$props;
    	let { targetPoints = null } = $$props;
    	let { yStart = 0 } = $$props;
    	let { yEnd = attHeight } = $$props;
    	let { activeSrcIdx = null } = $$props;
    	let { activeTargetIdx = null } = $$props;
    	console.log("Attentions? ", attentions);

    	// Smart defaults
    	if (srcPoints == null) {
    		srcPoints = attentions.reduce((acc, x) => [...acc, last$1(acc) + 10], [0]);
    	}

    	if (targetPoints == null) {
    		targetPoints = attentions[0].reduce((acc, x) => [...acc, last$1(acc) + 10], [0]);
    	}

    	console.log("Target points: ", targetPoints);
    	console.log("src points: ", srcPoints);

    	// assert square atts
    	// assert shapes match midpoints
    	let linkGen = linkVertical().x(d => d[0]).y(d => d[1]);

    	function makeLinksFromMidpoints(atts, startPoints, endPoints) {
    		return atts.map((src, i) => {
    			return src.map((att, j) => {
    				return {
    					source: [startPoints[i], yStart],
    					target: [endPoints[j], yEnd],
    					att
    				};
    			});
    		});
    	}

    	function highlightSource(i) {
    		$$invalidate(7, activeSrcIdx = i);
    	}

    	function highlightTarget(j) {
    		$$invalidate(8, activeTargetIdx = j);
    	}

    	$$self.$$set = $$props => {
    		if ("attentions" in $$props) $$invalidate(9, attentions = $$props.attentions);
    		if ("attHeight" in $$props) $$invalidate(10, attHeight = $$props.attHeight);
    		if ("srcPoints" in $$props) $$invalidate(5, srcPoints = $$props.srcPoints);
    		if ("targetPoints" in $$props) $$invalidate(6, targetPoints = $$props.targetPoints);
    		if ("yStart" in $$props) $$invalidate(11, yStart = $$props.yStart);
    		if ("yEnd" in $$props) $$invalidate(12, yEnd = $$props.yEnd);
    		if ("activeSrcIdx" in $$props) $$invalidate(7, activeSrcIdx = $$props.activeSrcIdx);
    		if ("activeTargetIdx" in $$props) $$invalidate(8, activeTargetIdx = $$props.activeTargetIdx);
    	};

    	let attLinks;
    	let maxAtt;
    	let opacityScale;
    	let widthScale;
    	let isInactive;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*attentions, srcPoints, targetPoints*/ 608) {
    			 $$invalidate(0, attLinks = makeLinksFromMidpoints(attentions, srcPoints, targetPoints));
    		}

    		if ($$self.$$.dirty & /*attentions*/ 512) {
    			 $$invalidate(18, maxAtt = max$2(attentions.map(max$2)));
    		}

    		if ($$self.$$.dirty & /*maxAtt*/ 262144) {
    			 $$invalidate(1, opacityScale = linear$1().domain([0, maxAtt]).range([0, 0.9]));
    		}

    		if ($$self.$$.dirty & /*opacityScale*/ 2) {
    			 $$invalidate(2, widthScale = v => 4 * opacityScale(v) ^ 0.33);
    		}

    		if ($$self.$$.dirty & /*activeSrcIdx, activeTargetIdx*/ 384) {
    			/**
     * Determine whether attention value should be connected or not
     */
    			 $$invalidate(3, isInactive = (i, j) => {
    				const inactiveSrc = activeSrcIdx != null && i != activeSrcIdx;
    				const inactiveTarget = activeTargetIdx != null && j != activeTargetIdx;
    				return inactiveSrc || inactiveTarget;
    			});
    		}
    	};

    	return [
    		attLinks,
    		opacityScale,
    		widthScale,
    		isInactive,
    		linkGen,
    		srcPoints,
    		targetPoints,
    		activeSrcIdx,
    		activeTargetIdx,
    		attentions,
    		attHeight,
    		yStart,
    		yEnd,
    		initial$1,
    		last$1,
    		max$2,
    		highlightSource,
    		highlightTarget
    	];
    }

    class AttentionConnector extends SvelteElement {
    	constructor(options) {
    		super();
    		this.shadowRoot.innerHTML = `<style>.att-connection{stroke:purple;fill:none}.inactive{stroke:gray}</style>`;

    		init(this, { target: this.shadowRoot }, instance$1, create_fragment$1, safe_not_equal, {
    			attentions: 9,
    			attHeight: 10,
    			srcPoints: 5,
    			targetPoints: 6,
    			yStart: 11,
    			yEnd: 12,
    			activeSrcIdx: 7,
    			activeTargetIdx: 8,
    			initial: 13,
    			last: 14,
    			max: 15,
    			highlightSource: 16,
    			highlightTarget: 17
    		});

    		if (options) {
    			if (options.target) {
    				insert(options.target, this, options.anchor);
    			}

    			if (options.props) {
    				this.$set(options.props);
    				flush();
    			}
    		}
    	}

    	static get observedAttributes() {
    		return [
    			"attentions",
    			"attHeight",
    			"srcPoints",
    			"targetPoints",
    			"yStart",
    			"yEnd",
    			"activeSrcIdx",
    			"activeTargetIdx",
    			"initial",
    			"last",
    			"max",
    			"highlightSource",
    			"highlightTarget"
    		];
    	}

    	get attentions() {
    		return this.$$.ctx[9];
    	}

    	set attentions(attentions) {
    		this.$set({ attentions });
    		flush();
    	}

    	get attHeight() {
    		return this.$$.ctx[10];
    	}

    	set attHeight(attHeight) {
    		this.$set({ attHeight });
    		flush();
    	}

    	get srcPoints() {
    		return this.$$.ctx[5];
    	}

    	set srcPoints(srcPoints) {
    		this.$set({ srcPoints });
    		flush();
    	}

    	get targetPoints() {
    		return this.$$.ctx[6];
    	}

    	set targetPoints(targetPoints) {
    		this.$set({ targetPoints });
    		flush();
    	}

    	get yStart() {
    		return this.$$.ctx[11];
    	}

    	set yStart(yStart) {
    		this.$set({ yStart });
    		flush();
    	}

    	get yEnd() {
    		return this.$$.ctx[12];
    	}

    	set yEnd(yEnd) {
    		this.$set({ yEnd });
    		flush();
    	}

    	get activeSrcIdx() {
    		return this.$$.ctx[7];
    	}

    	set activeSrcIdx(activeSrcIdx) {
    		this.$set({ activeSrcIdx });
    		flush();
    	}

    	get activeTargetIdx() {
    		return this.$$.ctx[8];
    	}

    	set activeTargetIdx(activeTargetIdx) {
    		this.$set({ activeTargetIdx });
    		flush();
    	}

    	get initial() {
    		return initial$1;
    	}

    	get last() {
    		return last$1;
    	}

    	get max() {
    		return max$2;
    	}

    	get highlightSource() {
    		return this.$$.ctx[16];
    	}

    	get highlightTarget() {
    		return this.$$.ctx[17];
    	}
    }

    customElements.define("attention-connector", AttentionConnector);

    /* src/Attention.svelte generated by Svelte v3.24.1 */

    function create_fragment$2(ctx) {
    	let svg;
    	let tokenrow0;
    	let attentionconnector;
    	let tokenrow1;
    	let current;

    	let tokenrow0_props = {
    		selectedInd: /*srcSelected*/ ctx[7],
    		tokens: /*tokens*/ ctx[2],
    		fontSize: /*fontSize*/ ctx[3],
    		tokenSpacing: /*tokenSpacing*/ ctx[5],
    		startY: /*fontSize*/ ctx[3],
    		alignment: "baseline"
    	};

    	tokenrow0 = new TokenRow({ props: tokenrow0_props });
    	/*tokenrow0_binding*/ ctx[19](tokenrow0);
    	tokenrow0.$on("click", /*click_handler*/ ctx[20]);
    	tokenrow0.$on("mouseover", /*mouseover_handler*/ ctx[21]);
    	tokenrow0.$on("mouseout", /*mouseout_handler*/ ctx[22]);

    	let attentionconnector_props = {
    		attentions: /*attentions*/ ctx[1],
    		attHeight: /*attHeight*/ ctx[4],
    		srcPoints: /*srcMidpoints*/ ctx[12],
    		targetPoints: /*targetMidpoints*/ ctx[13],
    		yStart: /*fontSize*/ ctx[3] + /*tokenAttSpace*/ ctx[6],
    		yEnd: /*fontSize*/ ctx[3] + /*attHeight*/ ctx[4] - /*tokenAttSpace*/ ctx[6]
    	};

    	attentionconnector = new AttentionConnector({ props: attentionconnector_props });
    	/*attentionconnector_binding*/ ctx[23](attentionconnector);

    	let tokenrow1_props = {
    		tokens: /*tokensTarget*/ ctx[0],
    		selectedInd: /*targetSelected*/ ctx[8],
    		fontSize: /*fontSize*/ ctx[3],
    		tokenSpacing: /*tokenSpacing*/ ctx[5],
    		startY: /*fontSize*/ ctx[3] + /*attHeight*/ ctx[4],
    		alignment: "hanging"
    	};

    	tokenrow1 = new TokenRow({ props: tokenrow1_props });
    	/*tokenrow1_binding*/ ctx[24](tokenrow1);
    	tokenrow1.$on("click", /*click_handler_1*/ ctx[25]);

    	return {
    		c() {
    			svg = svg_element("svg");
    			create_component(tokenrow0.$$.fragment);
    			create_component(attentionconnector.$$.fragment);
    			create_component(tokenrow1.$$.fragment);
    			this.c = noop;
    			attr(svg, "height", /*svgHeight*/ ctx[15]);
    			attr(svg, "width", /*svgWidth*/ ctx[14]);
    		},
    		m(target, anchor) {
    			insert(target, svg, anchor);
    			mount_component(tokenrow0, svg, null);
    			mount_component(attentionconnector, svg, null);
    			mount_component(tokenrow1, svg, null);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const tokenrow0_changes = {};
    			if (dirty[0] & /*srcSelected*/ 128) tokenrow0_changes.selectedInd = /*srcSelected*/ ctx[7];
    			if (dirty[0] & /*tokens*/ 4) tokenrow0_changes.tokens = /*tokens*/ ctx[2];
    			if (dirty[0] & /*fontSize*/ 8) tokenrow0_changes.fontSize = /*fontSize*/ ctx[3];
    			if (dirty[0] & /*tokenSpacing*/ 32) tokenrow0_changes.tokenSpacing = /*tokenSpacing*/ ctx[5];
    			if (dirty[0] & /*fontSize*/ 8) tokenrow0_changes.startY = /*fontSize*/ ctx[3];
    			tokenrow0.$set(tokenrow0_changes);
    			const attentionconnector_changes = {};
    			if (dirty[0] & /*attentions*/ 2) attentionconnector_changes.attentions = /*attentions*/ ctx[1];
    			if (dirty[0] & /*attHeight*/ 16) attentionconnector_changes.attHeight = /*attHeight*/ ctx[4];
    			if (dirty[0] & /*srcMidpoints*/ 4096) attentionconnector_changes.srcPoints = /*srcMidpoints*/ ctx[12];
    			if (dirty[0] & /*targetMidpoints*/ 8192) attentionconnector_changes.targetPoints = /*targetMidpoints*/ ctx[13];
    			if (dirty[0] & /*fontSize, tokenAttSpace*/ 72) attentionconnector_changes.yStart = /*fontSize*/ ctx[3] + /*tokenAttSpace*/ ctx[6];
    			if (dirty[0] & /*fontSize, attHeight, tokenAttSpace*/ 88) attentionconnector_changes.yEnd = /*fontSize*/ ctx[3] + /*attHeight*/ ctx[4] - /*tokenAttSpace*/ ctx[6];
    			attentionconnector.$set(attentionconnector_changes);
    			const tokenrow1_changes = {};
    			if (dirty[0] & /*tokensTarget*/ 1) tokenrow1_changes.tokens = /*tokensTarget*/ ctx[0];
    			if (dirty[0] & /*targetSelected*/ 256) tokenrow1_changes.selectedInd = /*targetSelected*/ ctx[8];
    			if (dirty[0] & /*fontSize*/ 8) tokenrow1_changes.fontSize = /*fontSize*/ ctx[3];
    			if (dirty[0] & /*tokenSpacing*/ 32) tokenrow1_changes.tokenSpacing = /*tokenSpacing*/ ctx[5];
    			if (dirty[0] & /*fontSize, attHeight*/ 24) tokenrow1_changes.startY = /*fontSize*/ ctx[3] + /*attHeight*/ ctx[4];
    			tokenrow1.$set(tokenrow1_changes);

    			if (!current || dirty[0] & /*svgHeight*/ 32768) {
    				attr(svg, "height", /*svgHeight*/ ctx[15]);
    			}

    			if (!current || dirty[0] & /*svgWidth*/ 16384) {
    				attr(svg, "width", /*svgWidth*/ ctx[14]);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(tokenrow0.$$.fragment, local);
    			transition_in(attentionconnector.$$.fragment, local);
    			transition_in(tokenrow1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(tokenrow0.$$.fragment, local);
    			transition_out(attentionconnector.$$.fragment, local);
    			transition_out(tokenrow1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(svg);
    			/*tokenrow0_binding*/ ctx[19](null);
    			destroy_component(tokenrow0);
    			/*attentionconnector_binding*/ ctx[23](null);
    			destroy_component(attentionconnector);
    			/*tokenrow1_binding*/ ctx[24](null);
    			destroy_component(tokenrow1);
    		}
    	};
    }

    function initial$2(arr) {
    	var length = arr == null ? 0 : arr.length;
    	return length ? arr.slice(0, -1) : [];
    }

    function last$2(array) {
    	var length = array == null ? 0 : array.length;
    	return length ? array[length - 1] : undefined;
    }

    function max$3(arr) {
    	return arr.reduce((acc, x) => x > acc ? x : acc, Number.NEGATIVE_INFINITY);
    }

    function randomArr(length) {
    	return Array.from(Array(length)).map(x => Math.random());
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let { tokens = ["Hello", "world", "."] } = $$props;
    	let { tokensTarget = null } = $$props;
    	let { attentions = null } = $$props;
    	let { fontSize = 22 } = $$props;
    	let { attHeight = 180 } = $$props;
    	let { tokenSpacing = 5 } = $$props;
    	let { tokenAttSpace = 8 } = $$props;
    	let srcSelected = null;
    	let targetSelected = null;

    	// Smart defaults
    	tokensTarget = tokensTarget == null ? tokens : tokensTarget;

    	attentions = attentions == null
    	? tokens.map(t => randomArr(tokensTarget.length))
    	: attentions;

    	console.log("Starting with!!! ", attentions);
    	let tokenSrcRow;
    	let tokenTargetRow;
    	let attentionConnector;
    	let srcMidpoints = null;
    	let targetMidpoints = null;
    	let svgWidth;

    	onMount(() => {
    		console.log("Found src row: ", tokenSrcRow);
    		$$invalidate(12, srcMidpoints = tokenSrcRow.midpoints());
    		$$invalidate(13, targetMidpoints = tokenTargetRow.midpoints());
    		$$invalidate(14, svgWidth = max([tokenSrcRow.totalWidth(), tokenTargetRow.totalWidth()]));
    	});

    	function toggleHighlight(srcIdx, targetIdx) {
    		if (attentionConnector != undefined) {
    			console.log("Active src, target: ", [srcSelected, targetSelected]);
    			attentionConnector.highlightSource(srcSelected);
    			attentionConnector.highlightTarget(targetSelected);
    		}
    	}

    	function tokenrow0_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			tokenSrcRow = $$value;
    			$$invalidate(9, tokenSrcRow);
    		});
    	}

    	const click_handler = e => {
    		let idx = e.detail.idx;
    		$$invalidate(8, targetSelected = null);
    		$$invalidate(7, srcSelected = srcSelected == idx ? null : idx);
    	};

    	const mouseover_handler = e => console.log("MOUSEOVER: ", e.detail.idx);
    	const mouseout_handler = e => console.log("MOUSEOUT: ", e.detail);

    	function attentionconnector_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			attentionConnector = $$value;
    			$$invalidate(11, attentionConnector);
    		});
    	}

    	function tokenrow1_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			tokenTargetRow = $$value;
    			$$invalidate(10, tokenTargetRow);
    		});
    	}

    	const click_handler_1 = e => {
    		let idx = e.detail.idx;
    		$$invalidate(7, srcSelected = null);
    		$$invalidate(8, targetSelected = targetSelected == idx ? null : idx);
    	};

    	$$self.$$set = $$props => {
    		if ("tokens" in $$props) $$invalidate(2, tokens = $$props.tokens);
    		if ("tokensTarget" in $$props) $$invalidate(0, tokensTarget = $$props.tokensTarget);
    		if ("attentions" in $$props) $$invalidate(1, attentions = $$props.attentions);
    		if ("fontSize" in $$props) $$invalidate(3, fontSize = $$props.fontSize);
    		if ("attHeight" in $$props) $$invalidate(4, attHeight = $$props.attHeight);
    		if ("tokenSpacing" in $$props) $$invalidate(5, tokenSpacing = $$props.tokenSpacing);
    		if ("tokenAttSpace" in $$props) $$invalidate(6, tokenAttSpace = $$props.tokenAttSpace);
    	};
    	let maxAtt;
    	let opacityScale;
    	let svgHeight;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty[0] & /*srcSelected, targetSelected*/ 384) ;

    		if ($$self.$$.dirty[0] & /*attentions*/ 2) {
    			 $$invalidate(27, maxAtt = max(attentions.map(a => max(a))));
    		}

    		if ($$self.$$.dirty[0] & /*maxAtt*/ 134217728) {
    			 $$invalidate(28, opacityScale = linear$1().domain([0, maxAtt]).range([0, 0.9]));
    		}

    		if ($$self.$$.dirty[0] & /*opacityScale*/ 268435456) ;

    		if ($$self.$$.dirty[0] & /*fontSize, attHeight*/ 24) {
    			 $$invalidate(15, svgHeight = 2 * fontSize + attHeight);
    		}

    		if ($$self.$$.dirty[0] & /*srcSelected, targetSelected*/ 384) {
    			 toggleHighlight();
    		}
    	};

    	return [
    		tokensTarget,
    		attentions,
    		tokens,
    		fontSize,
    		attHeight,
    		tokenSpacing,
    		tokenAttSpace,
    		srcSelected,
    		targetSelected,
    		tokenSrcRow,
    		tokenTargetRow,
    		attentionConnector,
    		srcMidpoints,
    		targetMidpoints,
    		svgWidth,
    		svgHeight,
    		initial$2,
    		last$2,
    		max$3,
    		tokenrow0_binding,
    		click_handler,
    		mouseover_handler,
    		mouseout_handler,
    		attentionconnector_binding,
    		tokenrow1_binding,
    		click_handler_1
    	];
    }

    class Attention extends SvelteElement {
    	constructor(options) {
    		super();

    		init(
    			this,
    			{ target: this.shadowRoot },
    			instance$2,
    			create_fragment$2,
    			safe_not_equal,
    			{
    				initial: 16,
    				last: 17,
    				max: 18,
    				tokens: 2,
    				tokensTarget: 0,
    				attentions: 1,
    				fontSize: 3,
    				attHeight: 4,
    				tokenSpacing: 5,
    				tokenAttSpace: 6
    			},
    			[-1, -1]
    		);

    		if (options) {
    			if (options.target) {
    				insert(options.target, this, options.anchor);
    			}

    			if (options.props) {
    				this.$set(options.props);
    				flush();
    			}
    		}
    	}

    	static get observedAttributes() {
    		return [
    			"initial",
    			"last",
    			"max",
    			"tokens",
    			"tokensTarget",
    			"attentions",
    			"fontSize",
    			"attHeight",
    			"tokenSpacing",
    			"tokenAttSpace"
    		];
    	}

    	get initial() {
    		return initial$2;
    	}

    	get last() {
    		return last$2;
    	}

    	get max() {
    		return max$3;
    	}

    	get tokens() {
    		return this.$$.ctx[2];
    	}

    	set tokens(tokens) {
    		this.$set({ tokens });
    		flush();
    	}

    	get tokensTarget() {
    		return this.$$.ctx[0];
    	}

    	set tokensTarget(tokensTarget) {
    		this.$set({ tokensTarget });
    		flush();
    	}

    	get attentions() {
    		return this.$$.ctx[1];
    	}

    	set attentions(attentions) {
    		this.$set({ attentions });
    		flush();
    	}

    	get fontSize() {
    		return this.$$.ctx[3];
    	}

    	set fontSize(fontSize) {
    		this.$set({ fontSize });
    		flush();
    	}

    	get attHeight() {
    		return this.$$.ctx[4];
    	}

    	set attHeight(attHeight) {
    		this.$set({ attHeight });
    		flush();
    	}

    	get tokenSpacing() {
    		return this.$$.ctx[5];
    	}

    	set tokenSpacing(tokenSpacing) {
    		this.$set({ tokenSpacing });
    		flush();
    	}

    	get tokenAttSpace() {
    		return this.$$.ctx[6];
    	}

    	set tokenAttSpace(tokenAttSpace) {
    		this.$set({ tokenAttSpace });
    		flush();
    	}
    }

    customElements.define("attention-vis", Attention);

    return Attention;

})));
