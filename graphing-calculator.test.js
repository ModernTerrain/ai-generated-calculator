"use strict";
/*
 * Tests for the calculator's "evaluate an expression without variables and
 * display the numerical answer" code path.
 *
 * HOW TO RUN (Node 22+, no dependencies; keep this file next to
 * graphing-calculator.html):
 *
 *   node --test --experimental-test-coverage \
 *        --test-coverage-lines=100 --test-coverage-branches=100 \
 *        --test-coverage-functions=100 graphing-calculator.test.js
 *
 * The code under test lives inside the page's <script>. This file copies the
 * calculation functions out of the HTML verbatim into calc-core.generated.js
 * (regenerated on every run) and loads that, so the tests always exercise
 * the real code and Node can report coverage on it.
 *
 * Code under test: tokenize, toRPN, evalRPN, parse, fmt (parsing and math),
 * plus evalRow and updateResult (the part that decides what the answer
 * display shows).
 */

const test = require("node:test");
const { describe, it } = test;
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/* ---------- load the real code out of the HTML ---------- */
const HTML_PATH = path.join(__dirname, "graphing-calculator.html");
const GENERATED_PATH = path.join(__dirname, "calc-core.generated.js");

function sliceBetween(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a < 0 || b < 0) {
    throw new Error(`Could not find "${startMarker}" ... "${endMarker}" in the HTML`);
  }
  return src.slice(a, b);
}

const html = fs.readFileSync(HTML_PATH, "utf8");
const mathCode = sliceBetween(
  html,
  "/* ---------- tokenizer ---------- */",
  "/* ---------- multi-line state ---------- */"
);
const displayCode = sliceBetween(html, "function evalRow(row){", "function addRow(text){");

fs.writeFileSync(
  GENERATED_PATH,
  '"use strict";\n' +
    "// AUTO-GENERATED from graphing-calculator.html by graphing-calculator.test.js. Do not edit.\n" +
    mathCode +
    "\n" +
    displayCode +
    "\nmodule.exports = { tokenize, toRPN, evalRPN, parse, fmt, evalRow, updateResult, FUNCS, CONSTS };\n"
);
const core = require(GENERATED_PATH);

/* ---------- helpers ---------- */
const MSG = {
  unbalanced: "Unbalanced parentheses",
  nothing: "Nothing to evaluate",
  malformed: "Malformed expression",
  enter: "Enter an expression",
  equals: "Only expressions or \u201cy = \u2026\u201d are supported",
};
const unknownName = (n) => `Unknown name \u201c${n}\u201d`;
const badChar = (c) => `Unexpected character \u201c${c}\u201d`;
const badNumber = (n) => `Bad number near \u201c${n}\u201d`;

/** Stand-in for the page's result <span>, recording text and the "err" class. */
function makeEl(startWithErr) {
  const classes = new Set(startWithErr ? ["err"] : []);
  return {
    textContent: "__untouched__",
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
  };
}

/** Runs the same steps the page runs for one row: evalRow then updateResult. */
function calc(text, extra) {
  const row = Object.assign(
    { text, parsed: null, error: null, hidden: false, _resultEl: makeEl(false) },
    extra || {}
  );
  core.evalRow(row);
  core.updateResult(row);
  return {
    shown: row._resultEl.textContent,
    isError: row._resultEl.classList.contains("err"),
    row,
  };
}

/** RPN as a readable string, e.g. "3 4 2 * +" ("u-" is unary minus). */
function rpnStr(rpn) {
  return rpn
    .map((k) => (k.t === "num" ? String(k.v) : k.t === "var" ? "x" : k.v))
    .join(" ");
}

/** Tokens as a readable string. */
function tokStr(tokens) {
  return tokens
    .map((k) => (k.t === "num" ? String(k.v) : k.t === "var" ? "x" : k.t === "fn" ? k.v : k.t === "op" ? k.v : k.t))
    .join(" ");
}

/* ======================================================================
 * 1. End-to-end: what the answer display shows for an expression
 * ==================================================================== */

describe("answer display: arithmetic results", () => {
  const ANSWERS = [
    // each operator
    ["1+2", "3"], ["7-10", "-3"], ["6*7", "42"], ["9/4", "2.25"], ["7%4", "3"], ["2^10", "1024"],
    // plain numbers
    ["5", "5"], ["0", "0"], ["3.5", "3.5"], ["0+0", "0"], [".5+.5", "1"],
    // decimals and rounding to 12 significant digits
    ["0.1+0.2", "0.3"], ["3.14159*2", "6.28318"], ["1/3", "0.333333333333"],
    ["2/3", "0.666666666667"], ["22/7", "3.14285714286"], ["123456.789", "123456.789"],
    ["0.000123", "0.000123"],
    // operator precedence
    ["2+3*4", "14"], ["(2+3)*4", "20"], ["2*3+4", "10"], ["2^3*4", "32"], ["4*2^3", "32"],
    ["2+3^2", "11"], ["12/4/3", "1"],
    // associativity
    ["10-3-2", "5"], ["100/10/5", "2"], ["2^3^2", "512"], ["10%4*2", "4"], ["20%7%4", "2"],
    ["2*3%4", "2"],
    // unary minus / plus
    ["-5", "-5"], ["+5", "5"], ["--3", "3"], ["-(2+3)", "-5"], ["2*-3", "-6"], ["2^-3", "0.125"],
    ["-2^2", "-4"], ["(-2)^2", "4"], ["-2*3", "-6"], ["3*+2", "6"], ["-5%3", "-2"],
    ["5--3", "8"], ["5+-3", "2"], ["5-+3", "2"], ["-(-(-1))", "-1"], ["+-+-4", "4"],
    // nesting
    ["((1+2)*(3+4))", "21"], ["((((5))))", "5"], ["(1+(2*(3+(4*5))))", "47"],
    // implicit multiplication
    ["2(3+4)", "14"], ["(1+1)(2+2)", "8"], ["(3)(4)(5)", "60"], ["(2)3", "6"], [".5(4)", "2"],
    ["3pi", "9.42477796077"], ["2pi", "6.28318530718"], ["pi(2)", "6.28318530718"],
    ["2sqrt(9)", "6"], ["sqrt(4)(3)", "6"], ["2sin(0)", "0"], ["2e", "5.43656365692"],
    // whitespace of every kind is ignored
    [" 1 + 2 ", "3"], ["1\t+\n2", "3"], ["  ( 1 + 2 )  *  3", "9"],
    // optional "y =" / "f(x) =" prefix on a constant expression
    ["y = 2+3", "5"], ["f(x) = 2*3", "6"], ["Y=1+1", "2"], ["F ( X ) = 4", "4"],
    ["y=  7", "7"], ["  y  =  8  ", "8"], ["f(x)=pi", "3.14159265359"],
  ];
  for (const [expr, want] of ANSWERS) {
    it(`${JSON.stringify(expr)} shows ${want}`, () => {
      const r = calc(expr);
      assert.equal(r.shown, want);
      assert.equal(r.isError, false);
    });
  }
});

describe("answer display: constants", () => {
  const CONSTS = [
    ["pi", "3.14159265359"], ["\u03c0", "3.14159265359"], ["e", "2.71828182846"],
    ["tau", "6.28318530718"], ["2*pi", "6.28318530718"], ["\u03c0*2", "6.28318530718"],
    ["e^1", "2.71828182846"], ["pi-pi", "0"],
  ];
  for (const [expr, want] of CONSTS) {
    it(`${JSON.stringify(expr)} shows ${want}`, () => {
      assert.equal(calc(expr).shown, want);
    });
  }
});

describe("answer display: every function", () => {
  const FNS = [
    ["sin(0)", "0"], ["sin(pi/2)", "1"], ["sin(pi/6)", "0.5"],
    ["cos(0)", "1"], ["cos(pi)", "-1"], ["tan(0)", "0"],
    ["asin(1)", "1.57079632679"], ["acos(1)", "0"], ["acos(0)", "1.57079632679"],
    ["atan(1)", "0.785398163397"],
    ["sinh(0)", "0"], ["sinh(1)", "1.17520119364"], ["cosh(0)", "1"], ["cosh(1)", "1.54308063482"],
    ["tanh(0)", "0"], ["tanh(1)", "0.761594155956"],
    ["sqrt(16)", "4"], ["sqrt(2)", "1.41421356237"], ["sqrt(0)", "0"],
    ["abs(-7.5)", "7.5"], ["abs(7.5)", "7.5"],
    ["ln(e)", "1"], ["ln(1)", "0"],
    ["log(1000)", "3"], ["log(100)", "2"], ["log(1)", "0"],
    ["exp(0)", "1"], ["exp(1)", "2.71828182846"],
    ["floor(2.7)", "2"], ["floor(-2.1)", "-3"], ["ceil(2.1)", "3"], ["ceil(-2.9)", "-2"],
    ["round(2.5)", "3"], ["round(2.4)", "2"],
    ["sign(-9)", "-1"], ["sign(0)", "0"], ["sign(5)", "1"],
    // composition and mixing with operators
    ["sqrt(sin(0)+4)", "2"], ["sin(cos(0)*pi/2)", "1"], ["2*sin(pi/2)+1", "3"],
    ["abs(-3)*2", "6"], ["-sqrt(9)", "-3"], ["sqrt(abs(-16))", "4"],
    // a function applied to a bare number (no parentheses)
    ["sqrt16", "4"], ["sqrt16+1", "5"], ["sin0+1", "1"],
  ];
  for (const [expr, want] of FNS) {
    it(`${JSON.stringify(expr)} shows ${want}`, () => {
      const r = calc(expr);
      assert.equal(r.shown, want);
      assert.equal(r.isError, false);
    });
  }
});

describe("answer display: number formatting", () => {
  const FORMAT = [
    // large values switch to exponent form at 1e10
    ["9999999999", "9999999999"], ["10^9", "1000000000"], ["10^10", "1.000000e+10"],
    ["10000000000", "1.000000e+10"], ["-10^10", "-1.000000e+10"],
    ["12345678901.5", "1.234568e+10"], ["123456789012", "1.234568e+11"],
    ["1000000*1000000", "1.000000e+12"], ["tan(pi/2)", "1.633124e+16"],
    // small values switch to exponent form below 1e-4
    ["0.0001", "0.0001"], ["0.00011", "0.00011"], ["10^-5", "1.000000e-5"], ["0.00001", "1.000000e-5"],
    ["-0.00001", "-1.000000e-5"], ["sin(pi)", "1.224647e-16"],
    // negative zero displays as plain 0
    ["-0", "0"], ["0-0", "0"], ["0*-5", "0"],
  ];
  for (const [expr, want] of FORMAT) {
    it(`${JSON.stringify(expr)} shows ${want}`, () => {
      assert.equal(calc(expr).shown, want);
    });
  }
});

describe("answer display: results that are not finite numbers", () => {
  // These are shown as answers (not as errors), exactly as JavaScript computes them.
  const NONFINITE = [
    ["1/0", "Infinity"], ["-1/0", "-Infinity"], ["0/0", "NaN"], ["1/0-1/0", "NaN"],
    ["sqrt(-1)", "NaN"], ["ln(0)", "-Infinity"], ["ln(-1)", "NaN"], ["asin(2)", "NaN"],
    ["acos(-2)", "NaN"], ["10%0", "NaN"], ["0^-1", "Infinity"], ["2^1024", "Infinity"],
    ["-2^1024", "-Infinity"],
  ];
  for (const [expr, want] of NONFINITE) {
    it(`${JSON.stringify(expr)} shows ${want} and is not flagged as an error`, () => {
      const r = calc(expr);
      assert.equal(r.shown, want);
      assert.equal(r.isError, false);
    });
  }
});

describe("answer display: expressions with x are graphed, not evaluated", () => {
  for (const expr of ["x", "X", "2x", "x^2+1", "sin(x)", "1/x", "x-x", "y = x", "f(x) = x*2"]) {
    it(`${JSON.stringify(expr)} shows "graphed"`, () => {
      const r = calc(expr);
      assert.equal(r.shown, "graphed");
      assert.equal(r.isError, false);
    });
    it(`${JSON.stringify(expr)} shows "hidden" when the line is hidden`, () => {
      const r = calc(expr, { hidden: true });
      assert.equal(r.shown, "hidden");
      assert.equal(r.isError, false);
    });
  }
});

describe("answer display: blank input", () => {
  for (const blank of ["", " ", "   ", "\t\n "]) {
    it(`${JSON.stringify(blank)} shows nothing and no error`, () => {
      const r = calc(blank);
      assert.equal(r.shown, "");
      assert.equal(r.isError, false);
      assert.equal(r.row.parsed, null);
      assert.equal(r.row.error, null);
    });
  }
});

describe("answer display: error messages", () => {
  const ERRORS = [
    // unknown names (names are case-sensitive; x/X is the only variable)
    ["foo", unknownName("foo")], ["y", unknownName("y")], ["xy", unknownName("xy")],
    ["PI", unknownName("PI")], ["Pi", unknownName("Pi")], ["E", unknownName("E")],
    ["z", unknownName("z")], ["2foo+1", unknownName("foo")], ["sinx", unknownName("sinx")],
    ["SIN(0)", unknownName("SIN")], ["sin(y)", unknownName("y")],
    // characters the calculator does not understand
    ["3#4", badChar("#")], ["2,5", badChar(",")], ["3!", badChar("!")], ["[1]", badChar("[")],
    ["2&3", badChar("&")], ["3\u00d74", badChar("\u00d7")], ["8\u00f72", badChar("\u00f7")],
    // malformed numbers
    [".", badNumber(".")], ["..", badNumber("..")], ["1+.", badNumber(".")],
    // unbalanced parentheses
    ["(1+2", MSG.unbalanced], ["1+2)", MSG.unbalanced], [")(", MSG.unbalanced],
    ["((1)", MSG.unbalanced], ["(", MSG.unbalanced], [")", MSG.unbalanced],
    ["2)(3", MSG.unbalanced],
    // nothing to compute
    ["()", MSG.nothing], ["(())", MSG.nothing], ["+", MSG.nothing], ["++", MSG.nothing],
    ["+()", MSG.nothing], ["y=", MSG.nothing], ["y= ", MSG.nothing],
    // operators / functions missing operands
    ["3+", MSG.malformed], ["*3", MSG.malformed], ["/", MSG.malformed], ["-", MSG.malformed],
    ["--", MSG.malformed], ["-+", MSG.malformed], ["sin()", MSG.malformed],
    ["sin", MSG.malformed], ["2()", MSG.malformed], ["2*", MSG.malformed],
    ["1+*2", MSG.malformed], ["2sin", MSG.malformed], ["2**3", MSG.malformed],
    ["2//3", MSG.malformed], ["2^^3", MSG.malformed], ["(1+)", MSG.malformed],
    ["3 4 +", MSG.malformed],
    // equations / comparisons are not supported
    ["1=1", MSG.equals], ["2=3", MSG.equals], ["x=5", MSG.equals], ["y=x=2", MSG.equals],
    ["y==2", MSG.equals], ["a=b", MSG.equals], ["=", MSG.equals],
  ];
  for (const [expr, want] of ERRORS) {
    it(`${JSON.stringify(expr)} shows "${want}"`, () => {
      const r = calc(expr);
      assert.equal(r.shown, want);
      assert.equal(r.isError, true);
    });
  }
});

describe("answer display: documented behaviors worth knowing about", () => {
  it("whitespace is removed before reading, so '2 3' is twenty-three, not 2*3", () => {
    assert.equal(calc("2 3").shown, "23");
    assert.equal(calc("1 0 + 5").shown, "15");
  });
  it("'2e3' is read as 2 * e * 3 (scientific notation is not supported)", () => {
    assert.equal(calc("2e3").shown, "16.3096909708");
  });
  it("10^-4 shows in exponent form: floating point makes it 0.00009999999999999999, just under 1e-4", () => {
    assert.equal(calc("10^-4").shown, "1.000000e-4");
    assert.equal(calc("0.0001").shown, "0.0001");
  });
  it("a name made of letters is one token, so 'xy' is not x*y", () => {
    assert.equal(calc("xy").shown, unknownName("xy"));
  });
});

/* Known bug, recorded as TODO tests: they assert the CORRECT behavior and are
 * reported as "todo" (they do not fail the run) until the code is fixed. */
describe("known issues (todo)", () => {
  it("rejects a number with two decimal points like 1.2.3", { todo: "parseFloat silently reads it as 1.2" }, () => {
    assert.throws(() => core.parse("1.2.3"), /Bad number/);
  });
  it("rejects '1..2' instead of reading it as 1", { todo: "parseFloat silently reads it as 1" }, () => {
    assert.throws(() => core.parse("1..2"), /Bad number/);
  });
});

/* ======================================================================
 * 2. updateResult: every branch of the display logic
 * ==================================================================== */

describe("updateResult", () => {
  it("does nothing (and does not throw) when the row has no result element", () => {
    const row = { text: "1+1", parsed: null, error: null };
    assert.equal(core.updateResult(row), undefined);
  });

  it("blank text clears the display and removes the error style", () => {
    const row = { text: "  ", parsed: null, error: null, _resultEl: makeEl(true) };
    core.updateResult(row);
    assert.equal(row._resultEl.textContent, "");
    assert.equal(row._resultEl.classList.contains("err"), false);
  });

  it("shows the stored error message with the error style", () => {
    const row = { text: "3+", parsed: null, error: "Boom", _resultEl: makeEl(false) };
    core.updateResult(row);
    assert.equal(row._resultEl.textContent, "Boom");
    assert.equal(row._resultEl.classList.contains("err"), true);
  });

  it("shows a numeric answer and removes a previous error style", () => {
    const row = { text: "2*21", parsed: core.parse("2*21"), error: null, _resultEl: makeEl(true) };
    core.updateResult(row);
    assert.equal(row._resultEl.textContent, "42");
    assert.equal(row._resultEl.classList.contains("err"), false);
  });

  it("shows 'graphed' for a variable expression and removes a previous error style", () => {
    const row = { text: "x", parsed: core.parse("x"), error: null, hidden: false, _resultEl: makeEl(true) };
    core.updateResult(row);
    assert.equal(row._resultEl.textContent, "graphed");
    assert.equal(row._resultEl.classList.contains("err"), false);
  });

  it("shows 'hidden' for a hidden variable expression", () => {
    const row = { text: "x", parsed: core.parse("x"), error: null, hidden: true, _resultEl: makeEl(false) };
    core.updateResult(row);
    assert.equal(row._resultEl.textContent, "hidden");
  });

  it("catches an error thrown while computing (parse succeeds, evaluation fails)", () => {
    const parsed = core.parse("3+"); // parses fine, but has no right-hand operand
    assert.equal(parsed.hasVar, false);
    const row = { text: "3+", parsed, error: null, _resultEl: makeEl(false) };
    core.updateResult(row);
    assert.equal(row._resultEl.textContent, MSG.malformed);
    assert.equal(row._resultEl.classList.contains("err"), true);
  });
});

/* ======================================================================
 * 3. evalRow
 * ==================================================================== */

describe("evalRow", () => {
  it("blank text clears any previous parse result and error", () => {
    const row = { text: "   ", parsed: { stale: true }, error: "old" };
    core.evalRow(row);
    assert.equal(row.parsed, null);
    assert.equal(row.error, null);
  });

  it("valid text stores the parsed expression and clears a previous error", () => {
    const row = { text: "1+2", parsed: null, error: "old" };
    core.evalRow(row);
    assert.equal(row.error, null);
    assert.equal(row.parsed.hasVar, false);
    assert.equal(rpnStr(row.parsed.rpn), "1 2 +");
  });

  it("invalid text stores the message and clears a previous parse result", () => {
    const row = { text: "1+#", parsed: { stale: true }, error: null };
    core.evalRow(row);
    assert.equal(row.parsed, null);
    assert.equal(row.error, badChar("#"));
  });
});

/* ======================================================================
 * 4. parse
 * ==================================================================== */

describe("parse", () => {
  it("rejects empty and whitespace-only input", () => {
    assert.throws(() => core.parse(""), { message: MSG.enter });
    assert.throws(() => core.parse("   "), { message: MSG.enter });
  });

  it("reports whether the expression uses x", () => {
    assert.equal(core.parse("1+2").hasVar, false);
    assert.equal(core.parse("x").hasVar, true);
    assert.equal(core.parse("sin(X)").hasVar, true);
  });

  it("trims the outside of the text but keeps inner spacing", () => {
    assert.equal(core.parse("  1 + 2  ").text, "1 + 2");
  });

  it("strips a leading 'y =' or 'f(x) =' (any case, any spacing)", () => {
    assert.equal(core.parse("y = 2+3").text, "2+3");
    assert.equal(core.parse("Y=2+3").text, "2+3");
    assert.equal(core.parse("f(x)=x").text, "x");
    assert.equal(core.parse("F ( X ) =  x").text, "x");
  });

  it("accepts non-string input by converting it to text", () => {
    assert.equal(rpnStr(core.parse(5).rpn), "5");
  });

  it("rejects any '=' that remains after the prefix is stripped", () => {
    assert.throws(() => core.parse("1=1"), { message: MSG.equals });
    assert.throws(() => core.parse("y=x=2"), { message: MSG.equals });
  });
});

/* ======================================================================
 * 5. tokenize
 * ==================================================================== */

describe("tokenize", () => {
  it("returns no tokens for empty input", () => {
    assert.deepEqual(core.tokenize(""), []);
  });

  it("reads integers, decimals and leading-dot decimals", () => {
    assert.equal(tokStr(core.tokenize("12")), "12");
    assert.equal(tokStr(core.tokenize("3.14")), "3.14");
    assert.equal(tokStr(core.tokenize(".5")), "0.5");
  });

  it("reads operators and parentheses", () => {
    assert.equal(tokStr(core.tokenize("(1+2)*3-4/5^6%7")), "( 1 + 2 ) * 3 - 4 / 5 ^ 6 % 7");
  });

  it("recognizes functions, the variable, and constants (as numbers)", () => {
    assert.equal(tokStr(core.tokenize("sin(x)")), "sin ( x )");
    assert.equal(tokStr(core.tokenize("X")), "x");
    assert.equal(tokStr(core.tokenize("tau")), String(2 * Math.PI));
    assert.equal(tokStr(core.tokenize("\u03c0")), String(Math.PI));
  });

  it("inserts implicit multiplication between adjacent values", () => {
    assert.equal(tokStr(core.tokenize("2x")), "2 * x");
    assert.equal(tokStr(core.tokenize("x2")), "x * 2");
    assert.equal(tokStr(core.tokenize("3(4)")), "3 * ( 4 )");
    assert.equal(tokStr(core.tokenize("(1)(2)")), "( 1 ) * ( 2 )");
    assert.equal(tokStr(core.tokenize("2sin(x)")), "2 * sin ( x )");
    assert.equal(tokStr(core.tokenize("x(2)")), "x * ( 2 )");
    assert.equal(tokStr(core.tokenize("(1)2")), "( 1 ) * 2");
  });

  it("does not insert multiplication after an operator, function or opening paren", () => {
    assert.equal(tokStr(core.tokenize("1+2")), "1 + 2");
    assert.equal(tokStr(core.tokenize("sin(2)")), "sin ( 2 )");
    assert.equal(tokStr(core.tokenize("sin2")), "sin 2");
    assert.equal(tokStr(core.tokenize("((1))")), "( ( 1 ) )");
  });

  it("ignores all whitespace", () => {
    assert.equal(tokStr(core.tokenize(" 1 \t+\n 2 ")), "1 + 2");
  });

  it("throws on unknown names, unexpected characters and malformed numbers", () => {
    assert.throws(() => core.tokenize("abc"), { message: unknownName("abc") });
    assert.throws(() => core.tokenize("1$2"), { message: badChar("$") });
    assert.throws(() => core.tokenize("."), { message: badNumber(".") });
  });
});

/* ======================================================================
 * 6. toRPN
 * ==================================================================== */

describe("toRPN", () => {
  const rpn = (s) => rpnStr(core.toRPN(core.tokenize(s)));

  it("orders operands and operators by precedence", () => {
    assert.equal(rpn("3+4*2"), "3 4 2 * +");
    assert.equal(rpn("3*4+2"), "3 4 * 2 +");
    assert.equal(rpn("(3+4)*2"), "3 4 + 2 *");
    assert.equal(rpn("2^3*4"), "2 3 ^ 4 *");
  });

  it("is left-associative for - / % and right-associative for ^", () => {
    assert.equal(rpn("10-3-2"), "10 3 - 2 -");
    assert.equal(rpn("100/10/5"), "100 10 / 5 /");
    assert.equal(rpn("20%7%4"), "20 7 % 4 %");
    assert.equal(rpn("2^3^2"), "2 3 2 ^ ^");
  });

  it("handles unary minus (and ignores unary plus)", () => {
    assert.equal(rpn("-x"), "x u-");
    assert.equal(rpn("-2^2"), "2 2 ^ u-");
    assert.equal(rpn("2^-3"), "2 3 u- ^");
    assert.equal(rpn("-2*3"), "2 u- 3 *");
    assert.equal(rpn("+5"), "5");
    assert.equal(rpn("5+-3"), "5 3 u- +");
  });

  it("places functions after their arguments", () => {
    assert.equal(rpn("sin(x)+1"), "x sin 1 +");
    assert.equal(rpn("sqrt16+1"), "16 sqrt 1 +");
    assert.equal(rpn("sin(cos(x))"), "x cos sin");
  });

  it("throws on unbalanced parentheses", () => {
    assert.throws(() => rpn("(1+2"), { message: MSG.unbalanced });
    assert.throws(() => rpn("1+2)"), { message: MSG.unbalanced });
  });

  it("throws when there is nothing to evaluate", () => {
    assert.throws(() => core.toRPN([]), { message: MSG.nothing });
    assert.throws(() => rpn("()"), { message: MSG.nothing });
  });
});

/* ======================================================================
 * 7. evalRPN
 * ==================================================================== */

describe("evalRPN", () => {
  const ev = (s, x) => core.evalRPN(core.parse(s).rpn, x);

  it("evaluates every binary operator", () => {
    assert.equal(ev("7+3"), 10);
    assert.equal(ev("7-3"), 4);
    assert.equal(ev("7*3"), 21);
    assert.equal(ev("7/2"), 3.5);
    assert.equal(ev("7%3"), 1);
    assert.equal(ev("7^2"), 49);
  });

  it("evaluates unary minus", () => {
    assert.equal(ev("-4"), -4);
    assert.equal(ev("--4"), 4);
  });

  it("evaluates functions and constants", () => {
    assert.equal(ev("sqrt(81)"), 9);
    assert.equal(ev("pi"), Math.PI);
    assert.equal(ev("e"), Math.E);
  });

  it("substitutes the supplied value for x", () => {
    assert.equal(ev("x^2+1", 3), 10);
    assert.equal(ev("x", -4), -4);
    assert.equal(ev("-x", 2), -2);
    assert.equal(ev("sin(x)", 0), 0);
    assert.equal(ev("1/x", 0), Infinity);
  });

  it("can reuse one parsed expression for many x values", () => {
    const rpnList = core.parse("x*x-1").rpn;
    assert.equal(core.evalRPN(rpnList, 2), 3);
    assert.equal(core.evalRPN(rpnList, -5), 24);
    assert.equal(core.evalRPN(rpnList, 2), 3);
  });

  it("throws when operands are missing", () => {
    assert.throws(() => ev("3+"), { message: MSG.malformed });
    assert.throws(() => ev("-"), { message: MSG.malformed });
    assert.throws(() => ev("sin"), { message: MSG.malformed });
  });

  it("throws unless exactly one value is left at the end", () => {
    assert.throws(() => core.evalRPN([]), { message: MSG.malformed });
    assert.throws(
      () => core.evalRPN([{ t: "num", v: 1 }, { t: "num", v: 2 }]),
      { message: MSG.malformed }
    );
  });
});

/* ======================================================================
 * 8. fmt
 * ==================================================================== */

describe("fmt", () => {
  const CASES = [
    [0, "0"], [-0, "0"], [5, "5"], [-5, "-5"], [2.25, "2.25"],
    [0.1 + 0.2, "0.3"], [1 / 3, "0.333333333333"],
    [1e-4, "0.0001"], [9.99e-5, "9.990000e-5"], [-9.99e-5, "-9.990000e-5"],
    [9999999999, "9999999999"], [1e10, "1.000000e+10"], [-1e10, "-1.000000e+10"],
    [123456789012, "1.234568e+11"],
    [Infinity, "Infinity"], [-Infinity, "-Infinity"], [NaN, "NaN"],
  ];
  for (const [n, want] of CASES) {
    it(`formats ${Object.is(n, -0) ? "-0" : n} as ${want}`, () => {
      assert.equal(core.fmt(n), want);
    });
  }
});

/* ======================================================================
 * 9. Built-in tables
 * ==================================================================== */

describe("function and constant tables", () => {
  it("offers exactly the documented functions", () => {
    assert.deepEqual(
      Object.keys(core.FUNCS).sort(),
      ["abs", "acos", "asin", "atan", "ceil", "cos", "cosh", "exp", "floor", "ln",
       "log", "round", "sign", "sin", "sinh", "sqrt", "tan", "tanh"].sort()
    );
  });
  it("log is base 10 and ln is natural", () => {
    assert.ok(Math.abs(core.FUNCS.log(1000) - 3) < 1e-12);
    assert.equal(core.FUNCS.ln(Math.E), 1);
  });
  it("offers pi, \u03c0, e and tau", () => {
    assert.equal(core.CONSTS.pi, Math.PI);
    assert.equal(core.CONSTS["\u03c0"], Math.PI);
    assert.equal(core.CONSTS.e, Math.E);
    assert.equal(core.CONSTS.tau, 2 * Math.PI);
  });
});

/* ======================================================================
 * 10. Differential tests against JavaScript's own arithmetic
 *     (seeded, so every run checks the same expressions)
 * ==================================================================== */

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const OPS = ["+", "-", "*", "/", "%"];
const jsEval = (expr) => new Function(`return (${expr});`)();
const myEval = (expr) => core.evalRPN(core.parse(expr).rpn, 0);

describe("agrees with JavaScript arithmetic", () => {
  it("on 1000 random fully parenthesized expressions (nesting, unary minus, / and % edge cases)", () => {
    const r = mulberry32(12345);
    const gen = (depth) => {
      if (depth === 0 || r() < 0.25) {
        const n = Math.floor(r() * 10);
        return r() < 0.2 ? `(-${n})` : String(n);
      }
      const op = OPS[Math.floor(r() * OPS.length)];
      return `(${gen(depth - 1)}${op}${gen(depth - 1)})`;
    };
    for (let i = 0; i < 1000; i++) {
      const expr = gen(1 + Math.floor(r() * 4));
      assert.ok(Object.is(myEval(expr), jsEval(expr)), `mismatch for ${expr}: ${myEval(expr)} vs ${jsEval(expr)}`);
    }
  });

  it("on 1000 random flat expressions (checks precedence and left-to-right grouping)", () => {
    const r = mulberry32(98765);
    for (let i = 0; i < 1000; i++) {
      const terms = 2 + Math.floor(r() * 5);
      let expr = String(1 + Math.floor(r() * 9));
      for (let j = 1; j < terms; j++) {
        expr += OPS[Math.floor(r() * OPS.length)] + (1 + Math.floor(r() * 9));
      }
      assert.ok(Object.is(myEval(expr), jsEval(expr)), `mismatch for ${expr}: ${myEval(expr)} vs ${jsEval(expr)}`);
    }
  });

  it("on random exponent expressions (^ is Math.pow, right-associative)", () => {
    const r = mulberry32(2468);
    for (let i = 0; i < 300; i++) {
      const a = 1 + Math.floor(r() * 4), b = 1 + Math.floor(r() * 3), c = 1 + Math.floor(r() * 3);
      assert.equal(myEval(`${a}^${b}^${c}`), Math.pow(a, Math.pow(b, c)));
      assert.equal(myEval(`-${a}^${b}`), -Math.pow(a, b));
      assert.equal(myEval(`(${a}^${b})^${c}`), Math.pow(Math.pow(a, b), c));
    }
  });
});
