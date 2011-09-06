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

// | caterwaul.regexp(/foo/).minimum_length()      // -> 3
//   caterwaul.regexp(/foo/).match_groups()        // -> []

// Syntax trees generated by caterwaul.regexp() know some things about the environment in which they were evaluated. For example:

// | caterwaul.regexp(/foo/i).i()                  // -> true
//   caterwaul.regexp(/^foo/m).m()                 // -> true

// Because these trees are still normal Caterwaul syntax trees, you can do all of the usual matching stuff (just with the caveat that if you want a wildcard you need to use it as a single word
// inside a (?:) group):

// | caterwaul.regexp(/(?:_a)*/).match(caterwaul.regexp(/a*/))        // -> {_a: a, _: a*}

// Configuration options.
// You can specify some options after the regexp that you're parsing. These impact how the parser works, sometimes doing things that are semantically incorrect but useful anyway. One such option
// is 'atom', which can bet set to either 'character' or 'word'. By default it's set to 'character', meaning that each character is considered a separate atom. This is semantically correct, since
// repetition operators such as + and * apply only to the preceding character.

// However, sometimes you want to consider each word to be its own atom; this is especially useful when building patterns and matching against them. For example:

// | caterwaul.regexp(/_foo _bar+/, {atom: 'word'}).match(caterwaul.regexp(/ab+/))         // -> {_foo: a, _bar: b, _: ab+}

// Setting {atom: 'word'} implies that literal whitespace is removed from the regexp, since otherwise there would be no way to separate words. You can still match space characters by using \x20.

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
  $.regexp(r, options) = $.regexp.parse.apply(this, arguments),
  $.regexp.syntax      = regexp_ctor /-$.syntax_subclass/ regexp_methods,
  $.regexp.parse       = regexp_parse,

  where [// Implementation note:
         // Copy-constructor functionality is triggered by passing an instance of the tree into its own constructor. The goal is to obtain a new instance of the same kind of tree, but without
         // any children. This is used by the rmap() method, which needs to build up a parallel tree but will add the children manually. That's what the 'data instanceof this.constructor'
         // check is all about.

         regexp_ctor(data, context) = data instanceof this.constructor ?
                                        this -se [it.data = data.data, it.length = 0, it.context = data.context] :
                                        this -se [it.data = data,      it.length = 0, it.context = context,      Array.prototype.slice.call(arguments, 2) *![it.push(x)] -seq],

         regexp_methods             = capture [i()                     = this.context.flags.i,
                                               m()                     = this.context.flags.m,
                                               g()                     = this.context.flags.g,

                                               match_groups()          = this.context.groups,

                                               is_zero_width()         = /^[\^\$]$|^\\[Bb]$/.test(this.data) || this.is_positive_lookahead() || this.is_negative_lookahead(),
                                               is_one_or_more()        = /^\+\??$/.test(this.data),
                                               is_zero_or_more()       = /^\*\??$/.test(this.data),
                                               is_optional()           = /^\?$/.test(this.data),
                                               is_non_greedy()         = /.\?$/.test(this.data),
                                               is_repetition()         = /^[\+\*\{]\??$|^\?$/.test(this.data),

                                               repeated_child()        = /^\{/.test(this.data) ? this[2] : this[0],

                                               is_character_class()    = /^\[/.test(this.data),
                                               is_single_escape()      = /^\\.+$/.test(this.data),

                                               is_range()              = /^-$/.test(this.data) && this.length === 2,

                                               is_atom()               = ! this.length,

                                               is_any_group()          = /^\(/.test(this.data),
                                               is_group()              = /^\($/.test(this.data),
                                               is_forgetful()          = /^\(\?:$/.test(this.data),
                                               is_positive_lookahead() = /^\(\?=$/.test(this.data),
                                               is_negative_lookahead() = /^\(\?!$/.test(this.data),

                                               is_backreference()      = /^\\$/.test(this.data),
                                               is_disjunction()        = /^\|$/.test(this.data) && this.length === 2,
                                               is_join()               = /^,$/.test(this.data)  && this.length === 2,

                                               lower_limit()           = /^\+\??$/.test(this.data)      ? 1 :
                                                                         /^\*\??$|^\?$/.test(this.data) ? 0 :
                                                                         /^\{/.test(this.data)          ? this[0].data :
                                                                                                          raise [new Error('lower limit is undefined for nonrepetitive node #{this}')],

                                               upper_limit()           = /^[\*\+]\??$/.test(this.data) ? Infinity :
                                                                         /^\?$/.test(this.data)        ? 1 :
                                                                         /^\{/.test(this.data)         ? this[1].data :
                                                                                                         raise [new Error('upper limit is undefined for nonrepetitive node #{this}')],

                                               minimum_length()        = this.is_zero_width()                                 ? 0 :
                                                                         this.is_single_escape() || this.is_character_class() ? 1 :
                                                                         this.is_repetition()                                 ? this.lower_limit() * this.repeated_child().minimum_length() :
                                                                         this.is_group() || this.is_forgetful()               ? this[0].minimum_length() :
                                                                         this.is_backreference()                              ? this[1].minimum_length() :
                                                                         this.is_disjunction()                                ? this[0].minimum_length() /-Math.min/ this[1].minimum_length() :
                                                                         this.is_join()                                       ? this[0].minimum_length() + this[1].minimum_length() :
                                                                                                                                this.data.length,

                                               toString()              = this.is_any_group()                                ? this.data + this[0].toString() + ')' :
                                                                         this.is_character_class()                          ? this.data + this[0].toString() + ']' :
                                                                         this.is_range()                                    ? '#{this[0].toString()}-#{this[1].toString()}' :
                                                                         this.is_zero_or_more() || this.is_one_or_more() ||
                                                                                                   this.is_optional()       ? this[0].toString() + this.data :
                                                                         this.is_repetition()                               ? this[2].toString() +
                                                                                                                              (this[0].data === this[1].data ? '{#{this[0].data}}' :
                                                                                                                               this[1].data === Infinity     ? '{#{this[0].data},}' :
                                                                                                                                                               '{#{this[0].data},#{this[1].data}}') :
                                                                         this.is_zero_width()                               ? this.data :
                                                                         this.is_backreference()                            ? '\\#{this[0].data}' :
                                                                         this.is_disjunction()                              ? '#{this[0].toString()}|#{this[1].toString()}' :
                                                                         this.is_join()                                     ? '#{this[0].toString()}#{this[1].toString()}' :
                                                                         this.is_atom()                                     ? /^\w{2,}$/.test(this.data) ? '(?:#{this.data})' : this.data :
                                                                                                                              this.data],

         regexp_parse(r, options)   = join(toplevel, end)({i: 0}) -re [it ? it.v[0] : raise [new Error('caterwaul.regexp(): failed to parse #{r.toString()}')]]

                              -where [settings                = {atom: 'character'} /-$.merge/ options,

                                      pieces                  = /^\/(.*)\/([gim]*)$/.exec(r.toString()) || /^(.*)$/.exec(r.toString()),
                                      s                       = pieces[1],
                                      flags                   = pieces[2] -re- {i: /i/.test(it), m: /m/.test(it), g: /g/.test(it)},
                                      context                 = {groups: [], flags: flags},

                                      add_group(node)         = context.groups.push(node),

                                      node(xs = arguments)    = new $.regexp.syntax(xs[0], context) -se- Array.prototype.slice.call(xs, 1) *![it.push(x)] /seq,

                                      // A very small parser combinator library without memoization.
                                      char(c)(p)              = p.i <  s.length && c.indexOf(s.charAt(p.i)) !== -1 && {v: s.charAt(p.i),            i: p.i + 1},
                                      string(cs)(p)           = p.i <  s.length && s.substr(p.i, cs.length) === cs && {v: s.substr(p.i, cs.length), i: p.i + cs.length},
                                      not(n, f)(p)            = p.i >= s.length || f(p) ? false : {v: s.substr(p.i, n), i: p.i + n},
                                      any(n)(p)               = p.i <  s.length && {v: s.substr(p.i, n), i: p.i + n},
                                      alt(ps = arguments)(p)  = ps |[x(p)] |seq,
                                      many(f)(p)              = p /~![f(x) || null] -seq -re- {v: it.slice(1) *[x.v] -seq, i: it[it.length - 1].i} /when [it.length > 1],
                                      join(ps = arguments)(p) = ps /[p][x0 && x(x0) -se [it && ns.push(it.v)]] -seq -re- {v: ns, i: it.i} /when.it -where [ns = []],
                                      zero(p)                 = p,

                                      map(parser, f)(p)       = {v: f(result.v), i: result.i} -when.result -where [result = parser(p)],

                                      ident                   = char('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_'),
                                      digit                   = char('0123456789'),
                                      hex                     = char('0123456789ABCDEFabcdef'),
                                      number                  = many(digit) /-map/ "+_.join('')".qf,

                                      end(p)                  = p.i === s.length && p,

                                      // Forward definition of recursive rules
                                      toplevel(p)             = toplevel(p),
                                      term(p)                 = term(p),
                                      atom(p)                 = atom(p),

                                      toplevel                = map(no_pipes /char('|') /~join/toplevel, "node('|', _[0], _[2])".qf) /-alt/ no_pipes
                                                        -where [no_pipes(p) = no_pipes(p),
                                                                no_pipes    = map(term /-join/ no_pipes, "node(',', _[0], _[1])".qf) /-alt/ term],

                                      term                    = map(atom /-join/ modifiers, "_[1] -se- it.push(_[0])".qf) /-alt/ atom
                                                        -where [star          = char('*') /-map/ node,
                                                                plus          = char('+') /-map/ node,
                                                                question_mark = char('?') /-map/ node,
                                                                repetition    = map(char('{') /number /~join/char('}'),                    "node('{', node(_[1]), node(_[1]))".qf) /
                                                                                map(char('{') /number /char(',') /~join/char('}'),         "node('{', node(_[1]), node(Infinity))".qf) /~alt/
                                                                                map(char('{') /number /char(',') /number /~join/char('}'), "node('{', node(_[1]), node(_[3]))".qf),

                                                                modifier      = star /plus /~alt/repetition,    // Deliberately omitting question mark, because it can't be non-greedy

                                                                non_greedy    = char('?'),
                                                                modifiers     = map(modifier /-join/ non_greedy, "_[0] -se [it.data += _[1]]".qf) /modifier /~alt/question_mark],

                                      atom                    = base
                                                        -where [positive_lookahead = map(string('(?=') /toplevel /~join/string(')'), "node('(?=', _[1])".qf),
                                                                negative_lookahead = map(string('(?!') /toplevel /~join/string(')'), "node('(?!', _[1])".qf),
                                                                forgetful_group    = map(string('(?:') /toplevel /~join/string(')'), "node('(?:', _[1])".qf),
                                                                group              = map(string('(')   /toplevel /~join/string(')'), "node('(',   _[1]) -se- add_group(it)".qf),

                                                                word               = map(many(ident),                                "node(_.join(''))".qf),
                                                                word_term          = map(string('(?:') /word /~join/string(')'),     "node(_[1])".qf),

                                                                character_class(p) = character_class(p),
                                                                character_class    = map(each /-join/ character_class, "node(',', _[0], _[1])".qf) /-alt/ each

                                                                             -where [each = map(any(1) /char('-') /~join/any(1), "node('-', node(_[0]), node(_[2]))".qf) /
                                                                                            map(char('\\') /-join/ any(1),       "node(_.join(''))".qf) /~alt/
                                                                                            map(not(1, char(']')),               node)],

                                                                character_not_in   = map(string('[^') /character_class /~join/string(']'), "node('[^', _[1])".qf),
                                                                character_in       = map(string('[')  /character_class /~join/string(']'), "node('[',  _[1])".qf),

                                                                zero_width         = char('^$') /-map/ node,
                                                                escaped            = map(char('\\') /-join/ char('BbWwSsDdfnrtv0*+.?|()[]{}\\$^'), "node(_.join(''))".qf),
                                                                escaped_slash      = map(string('\\/'),                                            "node('/')".qf),

                                                                control            = string('\\c') /-join/ any(1)            /-map/ "node(_.join(''))".qf,
                                                                hex_code           = string('\\x') /hex /~join/hex           /-map/ "node(_.join(''))".qf,
                                                                unicode            = string('\\u') /hex /hex /hex /~join/hex /-map/ "node(_.join(''))".qf,

                                                                // Fun stuff: Is the backreference within bounds? If not, then reject the second digit. This requires direct style rather than
                                                                // combinatory, since the parser's behavior changes as the parse is happening.
                                                                backreference(p)   = map(char('\\') /digit /~join/digit, "+'#{_[1]}#{_[2]}'".qf)(p)
                                                                                     -re [it && it.v <= context.groups.length ? {v: node('\\', node(it.v), context.groups[it.v]), i: it.i} :
                                                                                                                                single_digit_backreference(p)]

                                                                             -where [single_digit_backreference = map(char('\\') /-join/ digit,
                                                                                                                      given.xs in node('\\', node(+xs[1]), context.groups[+xs[1]]))],

                                                                dot                = char('.')              /-map/ node,
                                                                other              = not(1, char(')|+*?{')) /-map/ node,

                                                                maybe_word         = settings.atom === 'word' ? map(many(ident), "node(_.join(''))".qf) /-alt/ other :
                                                                                                                other,

                                                                maybe_munch_spaces = settings.atom === 'word' ? many(char(' ')) /-alt/ zero : zero,

                                                                base               = map(maybe_munch_spaces /-join/ alt(positive_lookahead, negative_lookahead, forgetful_group, group,
                                                                                                                        character_not_in, character_in, zero_width, escaped, escaped_slash,
                                                                                                                        control, hex_code, unicode, backreference, dot, maybe_word),
                                                                                         "_[1]".qf)]]]})(caterwaul);

// Generated by SDoc 
