// Caterwaul regular expression parser | Spencer Tipping
// Licensed under the terms of the MIT source code license

// Introduction.
// This library parses regular expressions into syntax trees. The resulting trees not only describe the structure of the regular expression but also provide information about the strings that it
// matches. It knows all of the standard Javascript regular expression constructs such as groups, backreferences, lookahead, etc.

// Implementation.
// Regular expressions support three binary operators. One is the dash, used for character ranges; another is the pipe, which is used for alternatives; and the third is the implicit join
// operator, used wherever two constructs are adjacent. The pipe has lower precedence than implicit joining, and the dash has higher precedence (though it's not exactly comparable, since it's
// special only inside a character class and implicit join does something different there).

// This parser interprets regular expressions a little differently than their syntax might suggest. For example:

// | caterwaul.regexp(/foo(?=bar)/).structure()    // -> '("," foo ("(?=" bar))'
//   caterwaul.regexp(/foo(?:bar)+/).structure()   // -> '("," foo ("+" ("(?:" bar)))'
//   caterwaul.regexp(/[a-z]/).structure()         // -> '("[" ("-" a z))'
//   caterwaul.regexp(/[^a-z]/).structure()        // -> '("[^" ("-" a z))'
//   caterwaul.regexp(/[a-zABC]/).structure()      // -> '("[" ("," ("-" a z) ("," A ("," B C))))
//   caterwaul.regexp(/[-abc]/).structure()        // -> '("[" ("," - ("," a ("," b c))))

// These syntax trees aren't instances of caterwaul.syntax. Rather, they're instances of caterwaul.regexp.syntax. Normally this isn't an important distinction, since they generally support the
// same set of methods. (All tree nodes inherit methods from caterwaul.syntax_common.) The only case where it really matters is that you get regexp-specific methods for these trees:

// | caterwaul.regexp(/foo/).example()             // -> 'foo'
//   caterwaul.regexp(/foo/).cardinality()         // -> 1
//   caterwaul.regexp(/foo/).minimum_length()      // -> 3
//   caterwaul.regexp(/foo/).maximum_length()      // -> 3
//   caterwaul.regexp(/foo/).match_groups()        // -> 0

// The minimum_length and maximum_length methods may not be useful in some cases. For example, caterwaul.regexp(/$/).maximum_length() returns Infinity, indicating that there is no string that
// will be so long that it fails to match. example() can also fail, and it will do so by throwing an error if no string can be found. For instance, caterwaul.regexp(/foo^bar/).example() complains
// that the ^ assertion can't be met because it has preceding characters and has no way to remove them. However, caterwaul.regexp(/(foo)?^bar/).example() happily returns 'bar'.

// There are some cases where example() erroneously fails. These have to do with weird ways in which you can use backreferences with lookaheads, e.g.
// caterwaul.regexp(/(foo)?bar(?=foo)\1/).example() complains because it won't revisit its initial assignment of (foo)? to the empty string. I consider this an acceptable failure, since the
// (foo)? term isn't really optional. Because nobody would do this in practice, I'm going to leave it this way. (This problem also affects minimum_length() and maximum_length().)

// Syntax trees generated by caterwaul.regexp() know some things about the environment in which they were evaluated. For example:

// | caterwaul.regexp(/foo/i).i()                  // -> true
//   caterwaul.regexp(/^foo/m).m()                 // -> true

// Because these trees are still normal Caterwaul syntax trees, you can do all of the usual matching stuff:

// | caterwaul.regexp(/_a*/).match(caterwaul.regexp(/xs*/))        // -> {_a: xs, _: xs*}

// Supported syntax.
// This library parses the following constructs (obtained from the Mozilla regular expression documentation: https://developer.mozilla.org/en/JavaScript/Guide/Regular_Expressions):

// | 1. Atoms                      e.g. /foo/, /bar./
//   2. Zero-width assertions      e.g. /^/, /$/, /\b/, /\B/
//   3. Repetition                 e.g. /a+/, /b*/, /a+?/, /b*?/, /c{10,20}/, /c{10}/, /c{10,}/, /c{10,20}?/, /c{10,}?/, /d?/
//   4. Capturing                  e.g. /a(.)c/
//   5. Non-capturing              e.g. /a(?:.)c/
//   6. Lookahead                  e.g. /a(?=b)/, /a(?!b)/
//   7. Disjunction                e.g. /a|b/
//   8. Character classes          e.g. /[abc]/, /[^abc]/, /[a-df]/
//   9. Special characters         e.g. /\w\W\s\S\d\D\f\n\r\t\v\0\xff\uffff/
//  10. Backreferences             e.g. /(a)\1/

// Backreferences have a peculiarity that I wasn't previously aware of. If there are more than ten match groups at the current parse point, then backreferences are parsed as potentially having
// two digits. Presumably the engine is insightful enough to discard digits that would forms numbers larger than the number of seen match groups, and this parser does that.

caterwaul.js_all()(function ($) {
  $.regexp(r)     = $.regexp.parse.apply(this, arguments),
  $.regexp.syntax = $.syntax_subclass(regexp_syntax_constructor, regexp_methods),
  $.regexp.parse  = regexp_parse,

  where [regexp_syntax_constructor(data, context) = data instanceof this.constructor ?
                                                      this -se [it.data = data.data, it.length = 0, it.context = data.context] :
                                                      this -se [it.data = data,      it.length = 0, it.context = context,      Array.prototype.slice.call(arguments, 2) *![it.push(x)] -seq],

         regexp_parse(r)                          = toplevel({i: 0}) -re [it ? it.v : raise [new Error('caterwaul.regexp(): failed to parse #{r.toString()}')]],

                                            -where [pieces                  = /^\/(.*)\/([gim]*)$/.exec(r.toString()) || /^(.*)$/.exec(r.toString()),
                                                    s                       = pieces[1],
                                                    flags                   = pieces[2] -re- {i: /i/.test(it), m: /m/.test(it), g: /g/.test(it)},
                                                    context                 = {groups: [], flags: flags},

                                                    add_group(node)         = context.groups.push(node),

                                                    node(xs = arguments)    = new regexp_syntax_constructor(xs[0], context) -se- xs.slice(1) *![it.push(x)] /seq,

                                                    // A very small parser combinator library without memoization.
                                                    char(c)(p)              = c.indexOf(s.charAt(p.i)) !== -1 && {v: s.charAt(p.i), i: p.i + 1},
                                                    string(cs)(p)           = s.substr(p.i, cs.length) === cs && {v: s.substr(p.i, cs.length), i: p.i + cs.length},
                                                    not(n, f)(p)            = f(p) ? false : {v: s.substr(p.i, n), i: p.i + n},
                                                    any(n)(p)               = {v: s.substr(p.i, n), i: p.i + n},
                                                    alt(ps = arguments)(p)  = ps |[x(p)] |seq,
                                                    many(f)(p)              = p /~![f(x) -se [it && ns.push(it.v)] || null] -seq -re- {v: ns, i: it.i} -where [ns = []],
                                                    join(ps = arguments)(p) = ps /[p][x0 && x(x0) -se- ns.push(it.v)] -seq -re- {v: ns, i: it.i} -where [ns = []],

                                                    map(parser)(f)(p)       = {v: f(result.v), i: result.i} -when.result -where [result = parser(p)],

                                                    ident       = char('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_'),
                                                    digit       = char('0123456789'),
                                                    hex         = char('0123456789ABCDEFabcdef'),
                                                    number      = map(join(digit), given.xs in +xs.join('')),

                                                    toplevel(p) = alt(map(join(no_pipes, char('|'), toplevel), given.xs in node('|', xs[0], xs[1])),
                                                                      no_pipes)(p)

                                                          -where [no_pipes(p) = alt(map(join(atom, no_pipes), given.xs in node(',', xs[0], xs[1])),
                                                                                    atom)],

                                                    atom(p)     = base(p)

                                                          -where [positive_lookahead = map(join(string('(?='), toplevel, string(')')), given.xs in node('(?=', xs[1])),
                                                                  negative_lookahead = map(join(string('(?!'), toplevel, string(')')), given.xs in node('(?!', xs[1])),
                                                                  forgetful_group    = map(join(string('(?:'), toplevel, string(')')), given.xs in node('(?:', xs[1])),
                                                                  group              = map(join(string('('),   toplevel, string(')')), given.xs in node('(',   xs[1]) -se- add_group(it)),

                                                                  character_class(p) = alt(map(join(each, character_class), given.xs in node(',', xs[0], xs[1])),
                                                                                           each)(p),

                                                                               -where [each = alt(map(join(any(1), char('-'), any(1)), given.xs in node('-', node(xs[0]), node(xs[2]))),
                                                                                                  map(join(char('\\'), any(1)),        given.xs in node(xs.join(''))),
                                                                                                  map(any(1),                          node))],

                                                                  character_not_in   = map(join(string('[^'),  character_class, string(']')), given.xs in node('[^', xs[1])),
                                                                  character_in       = map(join(string('['),   character_class, string(']')), given.xs in node('[',  xs[1])),

                                                                  zero_width         = map(alt(char('^$'), map(join(char('\\'), char('bB')),      given.xs in xs.join(''))), node),
                                                                  escaped            = map(join(char('\\'), char('WwSsDdfnrtv0*+.?|()[]{}\\$^')), given.xs in node(xs.join(''))),
                                                                  escaped_slash      = map(string('\\/'),                                         given.x  in node('/')),

                                                                  control            = map(join(string('\\c'), any(1)),             given.xs in node(xs.join(''))),
                                                                  hex_code           = map(join(string('\\x'), hex, hex),           given.xs in node(xs.join(''))),
                                                                  unicode            = map(join(string('\\u'), hex, hex, hex, hex), given.xs in node(xs.join(''))),

                                                                  // Fun stuff: Is the backreference within bounds? If not, then reject the second digit. This requires direct style rather than
                                                                  // combinatory, since the parser's behavior changes as the parse is happening.
                                                                  backreference(p)   = map(join(char('\\'), digit, digit), given.xs in +'#{xs[1]}#{xs[2]}')(p)
                                                                                       -re [it && it.v <= context.groups ? {v: node('\\', it.v, context.groups[it.v]), i: it.i} :
                                                                                                                           single_digit_backreference(p)]

                                                                               -where [single_digit_backreference = map(join(char('\\'), digit),
                                                                                                                        given.xs in node('\\', +xs[1], context.groups[+xs[1]]))],

                                                                  dot                = map(char('.'), node),
                                                                  word               = map(many(ident), given.xs in node(xs.join(''))),
                                                                  other              = map(not(char(')|')), node),

                                                                  base               = alt(positive_lookahead, negative_lookahead, forgetful_group, group,
                                                                                           character_not_in, character_in, zero_width, escaped, escaped_slash,
                                                                                           control, hex_code, unicode, backreference, dot, word, other)]]]})(caterwaul);

// Generated by SDoc 