/* MONKEY BAITING — yaml.js
   Self-contained YAML-subset parser. No dependencies, browser + node.
   Supports: nested maps, lists (incl. "- key: value" item maps), scalars
   (numbers, bools, null, quoted/plain strings), comments, block scalars
   (| literal, > folded), and single-line flow {a: 1} / [1, 2].
   Anything outside this subset throws. */
(function (g) {
  'use strict';

  function YamlError(file, lineNo, msg) {
    return new Error('YAML error in ' + file + ' line ' + lineNo + ': ' + msg);
  }

  // Strip a trailing comment, respecting quotes. Returns the line content.
  function stripComment(line) {
    var inS = false, inD = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === "'" && !inD) inS = !inS;
      else if (c === '"' && !inS) inD = !inD;
      else if (c === '#' && !inS && !inD && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
        return line.slice(0, i);
      }
    }
    return line;
  }

  function indentOf(line) {
    var n = 0;
    while (n < line.length && line[n] === ' ') n++;
    return n;
  }

  function Parser(src, file) {
    this.file = file || '(yaml)';
    this.lines = src.split(/\r?\n/);
  }

  Parser.prototype.err = function (i, msg) { throw YamlError(this.file, i + 1, msg); };

  // Is line i blank or comment-only?
  Parser.prototype.isBlank = function (i) {
    var t = stripComment(this.lines[i]);
    return /^\s*$/.test(t);
  };

  Parser.prototype.content = function (i) {
    var t = stripComment(this.lines[i]);
    return t.replace(/\s+$/, '');
  };

  // Skip blank lines starting at i; return next significant index or lines.length.
  Parser.prototype.skipBlank = function (i) {
    while (i < this.lines.length && this.isBlank(i)) i++;
    return i;
  };

  Parser.prototype.parse = function () {
    var i = this.skipBlank(0);
    if (i >= this.lines.length) return null;
    var r = this.parseBlock(i, indentOf(this.content(i)));
    var rest = this.skipBlank(r.next);
    if (rest < this.lines.length) this.err(rest, 'unexpected content after document (indentation error?)');
    return r.value;
  };

  // Parse a block (map or list) whose items sit at exactly `indent`.
  Parser.prototype.parseBlock = function (start, indent) {
    var i = this.skipBlank(start);
    if (i >= this.lines.length) return { value: null, next: i };
    var first = this.content(i);
    var isList = /^\s*-(\s|$)/.test(first);
    return isList ? this.parseList(i, indent) : this.parseMap(i, indent);
  };

  Parser.prototype.parseMap = function (start, indent) {
    var map = {}, i = start;
    while (i < this.lines.length) {
      i = this.skipBlank(i);
      if (i >= this.lines.length) break;
      var line = this.content(i);
      var ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) this.err(i, 'bad indentation (expected ' + indent + ', got ' + ind + ')');
      var body = line.slice(ind);
      var m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(?:\s+(.*))?$/.exec(body);
      if (!m) {
        if (/^-(\s|$)/.test(body)) this.err(i, 'list item where map key expected');
        this.err(i, 'cannot parse map entry: "' + body + '"');
      }
      var key = m[1], rest = m[2];
      if (Object.prototype.hasOwnProperty.call(map, key)) this.err(i, 'duplicate key "' + key + '"');
      if (rest === undefined || rest === '') {
        var nx = this.skipBlank(i + 1);
        if (nx >= this.lines.length || indentOf(this.content(nx)) <= indent) {
          map[key] = null; i = i + 1;
        } else {
          var r = this.parseBlock(nx, indentOf(this.content(nx)));
          map[key] = r.value; i = r.next;
        }
      } else if (rest === '|' || rest === '>') {
        var b = this.parseBlockScalar(i + 1, indent, rest);
        map[key] = b.value; i = b.next;
      } else {
        map[key] = this.parseValue(rest, i);
        i = i + 1;
      }
    }
    return { value: map, next: i };
  };

  Parser.prototype.parseList = function (start, indent) {
    var list = [], i = start;
    while (i < this.lines.length) {
      i = this.skipBlank(i);
      if (i >= this.lines.length) break;
      var line = this.content(i);
      var ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) this.err(i, 'bad indentation in list');
      var body = line.slice(ind);
      if (!/^-(\s|$)/.test(body)) break;
      var rest = body.replace(/^-\s*/, '');
      if (rest === '') {
        // nested block item
        var nx = this.skipBlank(i + 1);
        if (nx >= this.lines.length || indentOf(this.content(nx)) <= indent) { list.push(null); i = i + 1; }
        else { var r0 = this.parseBlock(nx, indentOf(this.content(nx))); list.push(r0.value); i = r0.next; }
      } else if (/^[A-Za-z_][A-Za-z0-9_-]*\s*:(\s|$)/.test(rest)) {
        // "- key: value" — rewrite the dash as spaces and parse a map at that column
        var off = ind + (body.length - rest.length);
        var saved = this.lines[i];
        this.lines[i] = new Array(off + 1).join(' ') + rest;
        var r1 = this.parseMap(i, off);
        this.lines[i] = saved;
        list.push(r1.value); i = r1.next;
      } else if (rest === '|' || rest === '>') {
        var b = this.parseBlockScalar(i + 1, indent, rest);
        list.push(b.value); i = b.next;
      } else {
        list.push(this.parseValue(rest, i));
        i = i + 1;
      }
    }
    return { value: list, next: i };
  };

  // Block scalar: consume raw lines more indented than `indent`.
  Parser.prototype.parseBlockScalar = function (start, indent, style) {
    var raw = [], i = start, base = -1;
    while (i < this.lines.length) {
      var line = this.lines[i];
      if (/^\s*$/.test(line)) { raw.push(''); i++; continue; }
      var ind = indentOf(line);
      if (ind <= indent) break;
      if (base < 0) base = ind;
      raw.push(line.slice(Math.min(base, ind)).replace(/\s+$/, ''));
      i++;
    }
    while (raw.length && raw[raw.length - 1] === '') raw.pop();
    var text;
    if (style === '|') {
      text = raw.join('\n');
    } else { // folded: single newlines -> space, blank lines -> newline
      var paras = [], cur = [];
      for (var k = 0; k < raw.length; k++) {
        if (raw[k] === '') { if (cur.length) { paras.push(cur.join(' ')); cur = []; } paras.push(''); }
        else cur.push(raw[k]);
      }
      if (cur.length) paras.push(cur.join(' '));
      while (paras.length && paras[paras.length - 1] === '') paras.pop();
      text = paras.join('\n').replace(/\n\n+/g, function (s) { return s.slice(1); });
    }
    return { value: text, next: i };
  };

  Parser.prototype.parseValue = function (s, lineIdx) {
    s = s.trim();
    if (s[0] === '{' || s[0] === '[') return this.parseFlow(s, lineIdx);
    return this.parseScalar(s, lineIdx);
  };

  Parser.prototype.parseScalar = function (s, lineIdx) {
    if (s === '' || s === '~' || s === 'null') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
    var q = s[0];
    if (q === '"' || q === "'") {
      if (s[s.length - 1] !== q || s.length < 2) this.err(lineIdx, 'unterminated quoted string');
      var body = s.slice(1, -1);
      if (q === '"') {
        return body.replace(/\\(.)/g, function (_, c) {
          if (c === 'n') return '\n';
          if (c === 't') return '\t';
          return c;
        });
      }
      return body.replace(/''/g, "'");
    }
    return s;
  };

  // Minimal single-line flow parser for {…} and […], supports nesting.
  Parser.prototype.parseFlow = function (s, lineIdx) {
    var self = this, pos = 0;
    function ws() { while (pos < s.length && (s[pos] === ' ' || s[pos] === '\t')) pos++; }
    function fail(msg) { self.err(lineIdx, msg + ' in flow value "' + s + '"'); }
    function value() {
      ws();
      var c = s[pos];
      if (c === '{') return fmap();
      if (c === '[') return flist();
      var start = pos, depth = 0, inQ = null;
      while (pos < s.length) {
        c = s[pos];
        if (inQ) { if (c === inQ) inQ = null; }
        else if (c === '"' || c === "'") inQ = c;
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']' || c === ',') { if (depth === 0) break; if (c !== ',') depth--; }
        pos++;
      }
      return self.parseScalar(s.slice(start, pos).trim(), lineIdx);
    }
    function fmap() {
      pos++; // {
      var obj = {};
      ws();
      if (s[pos] === '}') { pos++; return obj; }
      for (;;) {
        ws();
        var m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:/.exec(s.slice(pos));
        if (!m) fail('expected key');
        pos += m[0].length;
        obj[m[1]] = value();
        ws();
        if (s[pos] === ',') { pos++; continue; }
        if (s[pos] === '}') { pos++; return obj; }
        fail('expected , or }');
      }
    }
    function flist() {
      pos++; // [
      var arr = [];
      ws();
      if (s[pos] === ']') { pos++; return arr; }
      for (;;) {
        arr.push(value());
        ws();
        if (s[pos] === ',') { pos++; continue; }
        if (s[pos] === ']') { pos++; return arr; }
        fail('expected , or ]');
      }
    }
    var v = value();
    ws();
    if (pos !== s.length) fail('trailing content');
    return v;
  };

  var YAML = {
    parse: function (src, filename) { return new Parser(src, filename).parse(); }
  };

  g.MB = g.MB || {};
  g.MB.YAML = YAML;
  if (typeof module !== 'undefined' && module.exports) module.exports = YAML;
})(typeof window !== 'undefined' ? window : globalThis);
