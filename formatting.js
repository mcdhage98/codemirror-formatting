(function (mod) {
  if (typeof exports == "object" && typeof module == "object")
    // CommonJS
    mod(require("codemirror/lib/codemirror"));
  else if (typeof define == "function" && define.amd)
    // AMD
    define(["codemirror/lib/codemirror"], mod);
  // Plain browser env
  else mod(CodeMirror);
})(function (CodeMirror) {
  function preprocessCode(code) {
    return code.replace(/(`[^`]*`)/g, (match) => {
      // Escape template literals or preserve them in a special format
      return `\0${btoa(match)}\0`; // Encode with base64 to protect the content
    });
  }

  // Function to postprocess the code, restore the original template literals
  function postprocessCode(code) {
    return code.replace(/\0([^]*?)\0/g, (match, encoded) => {
      // Decode the base64 back into the original template literal
      return atob(encoded);
    });
  }

  CodeMirror.extendMode("css", {
    commentStart: "/*",
    commentEnd: "*/",
    newlineAfterToken: function (_type, content) {
      return /^[;{}]$/.test(content);
    },
  });

  CodeMirror.extendMode("javascript", {
    commentStart: "/*",
    commentEnd: "*/",
    // FIXME semicolons inside of for
    newlineAfterToken: function (_type, content, textAfter, state) {
      if (this.jsonMode) {
        return /^[\[,{]$/.test(content) || /^}/.test(textAfter);
      } else {
        if (content == ";" && state.lexical && state.lexical.type == ")")
          return false;
        return /^[;{}]$/.test(content) && !/^;/.test(textAfter);
      }
    },
  });

  var inlineElements =
    /^(a|abbr|acronym|area|base|bdo|big|br|button|caption|cite|code|col|colgroup|dd|del|dfn|em|frame|hr|iframe|img|input|ins|kbd|label|legend|link|map|object|optgroup|option|param|q|samp|script|select|small|span|strong|sub|sup|textarea|tt|var)$/;

  CodeMirror.extendMode("xml", {
    commentStart: "<!--",
    commentEnd: "-->",
    newlineAfterToken: function (type, content, textAfter, state) {
      var inline = false;
      if (this.configuration == "html")
        inline = state.context
          ? inlineElements.test(state.context.tagName)
          : false;
      return (
        !inline &&
        ((type == "tag" && />$/.test(content) && state.context) ||
          /^</.test(textAfter))
      );
    },
  });

  // Comment/uncomment the specified range
  CodeMirror.defineExtension("commentRange", function (isComment, from, to) {
    var cm = this,
      curMode = CodeMirror.innerMode(
        cm.getMode(),
        cm.getTokenAt(from).state
      ).mode;
    cm.operation(function () {
      if (isComment) {
        // Comment range
        cm.replaceRange(curMode.commentEnd, to);
        cm.replaceRange(curMode.commentStart, from);
        if (from.line == to.line && from.ch == to.ch)
          // An empty comment inserted - put cursor inside
          cm.setCursor(from.line, from.ch + curMode.commentStart.length);
      } else {
        // Uncomment range
        var selText = cm.getRange(from, to);
        var startIndex = selText.indexOf(curMode.commentStart);
        var endIndex = selText.lastIndexOf(curMode.commentEnd);
        if (startIndex > -1 && endIndex > -1 && endIndex > startIndex) {
          // Take string till comment start
          selText =
            selText.substr(0, startIndex) +
            // From comment start till comment end
            selText.substring(
              startIndex + curMode.commentStart.length,
              endIndex
            ) +
            // From comment end till string end
            selText.substr(endIndex + curMode.commentEnd.length);
        }
        cm.replaceRange(selText, from, to);
      }
    });
  });

  // Applies automatic mode-aware indentation to the specified range
  CodeMirror.defineExtension("autoIndentRange", function (from, to) {
    var cmInstance = this;
    this.operation(function () {
      for (var i = from.line; i <= to.line; i++) {
        cmInstance.indentLine(i, "smart");
      }
    });
  });

  // Applies automatic formatting to the specified range
  CodeMirror.defineExtension("autoFormatRange", function (from, to) {
    var cm = this;
    var outer = cm.getMode();
    var text = cm.getRange(from, to);
    text = preprocessCode(text);
    text = text.split("\n");
    //text = preprocessCode(text);

    var state = CodeMirror.copyState(outer, cm.getTokenAt(from).state);
    var tabSize = cm.getOption("tabSize");

    var out = "",
      lines = 0,
      atSol = from.ch === 0;
    function newline() {
      out += "\n";
      atSol = true;
      ++lines;
    }

    for (var i = 0; i < text.length; ++i) {
      var stream = new CodeMirror.StringStream(text[i], tabSize);
      while (!stream.eol()) {
        var inner = CodeMirror.innerMode(outer, state);
        var style = outer.token(stream, state),
          cur = stream.current();
        stream.start = stream.pos;
        if (!atSol || /\S/.test(cur)) {
          out += cur;
          atSol = false;
        }
        if (
          !atSol &&
          inner.mode.newlineAfterToken &&
          inner.mode.newlineAfterToken(
            style,
            cur,
            stream.string.slice(stream.pos) || text[i + 1] || "",
            inner.state
          )
        )
          newline();
      }
      if (!stream.pos && outer.blankLine) outer.blankLine(state);
      if (!atSol && i < text.length - 1) newline();
    }

    cm.operation(function () {
      out = postprocessCode(out);
      cm.replaceRange(out, from, to);
      for (var cur = from.line + 1, end = from.line + lines; cur <= end; ++cur)
        cm.indentLine(cur, "smart");
      cm.setSelection(from, cm.getCursor(false));
    });
  });

  /*
  CodeMirror.defineExtension('autoFormatRange', function (from, to) {
    var cm = this;
    var outer = cm.getMode(),
      text = cm.getRange(from, to).split('\n');
    var state = CodeMirror.copyState(outer, cm.getTokenAt(from).state);
    var tabSize = cm.getOption('tabSize');

    var out = '',
      lines = 0,
      atSol = from.ch === 0;
    function newline() {
      out += '\n';
      atSol = true;
      ++lines;
    }

    var insideString = false; // To track if we are inside a string (including template literals)
    var stringType = null; // Track type of string (single quote, double quote, or template literal)

    for (var i = 0; i < text.length; ++i) {
      var stream = new CodeMirror.StringStream(text[i], tabSize);
      while (!stream.eol()) {
        var inner = CodeMirror.innerMode(outer, state);
        var style = outer.token(stream, state),
          cur = stream.current();
        stream.start = stream.pos;

        // Detect start or end of strings (including template literals)
        if (!insideString && (style === 'string' || style === 'string-2')) {
          insideString = true;
          stringType = cur[0]; // Store the opening character (` " or ')
        } else if (insideString && cur.endsWith(stringType)) {
          insideString = false; // End of string or template literal
        }

        // Handle template literals interpolation expressions `${...}`
        if (insideString && stringType === '`' && /\$\{/.test(cur)) {
          // We're inside a template literal and found `${`, keep it intact
          out += cur;
          atSol = false;
        } else if (insideString) {
          // Don't modify anything inside string literals or template literals
          out += cur;
          atSol = false;
        } else {
          // Standard formatting for non-string code
          if (!atSol || /\S/.test(cur)) {
            out += cur;
            atSol = false;
          }
          if (
            !atSol &&
            inner.mode.newlineAfterToken &&
            inner.mode.newlineAfterToken(
              style,
              cur,
              stream.string.slice(stream.pos) || text[i + 1] || '',
              inner.state
            )
          )
            newline();
        }
      }

      if (!stream.pos && outer.blankLine) outer.blankLine(state);
      if (!atSol && i < text.length - 1) newline();
    }

    cm.operation(function () {
      cm.replaceRange(out, from, to);
      for (var cur = from.line + 1, end = from.line + lines; cur <= end; ++cur)
        cm.indentLine(cur, 'smart');
      cm.setSelection(from, cm.getCursor(false));
    });
  });*/
});
