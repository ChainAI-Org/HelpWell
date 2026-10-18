/**
 * Split a .sql file into individual statements.
 *
 * Both drivers send statements over the extended protocol, which takes exactly
 * one command at a time, so a migration file has to be split before it runs.
 * Splitting on ";" alone would break the moment a migration contains a
 * semicolon inside a string, a comment or a dollar-quoted function body, so
 * this walks the text and tracks what it is inside of.
 */

export function splitSql(input: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;
    const next = input[i + 1];

    // -- line comment
    if (ch === '-' && next === '-') {
      const end = input.indexOf('\n', i);
      const stop = end === -1 ? input.length : end;
      current += input.slice(i, stop);
      i = stop;
      continue;
    }

    // /* block comment */ (Postgres nests them)
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < input.length && depth > 0) {
        if (input[j] === '/' && input[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (input[j] === '*' && input[j + 1] === '/') {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      current += input.slice(i, j);
      i = j;
      continue;
    }

    // 'string literal' with '' escapes
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < input.length) {
        if (input[j] === quote && input[j + 1] === quote) {
          j += 2;
          continue;
        }
        if (input[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      current += input.slice(i, j);
      i = j;
      continue;
    }

    // $tag$ dollar-quoted body $tag$ (function bodies)
    if (ch === '$') {
      const match = /^\$[A-Za-z_]*\$/.exec(input.slice(i));
      if (match) {
        const tag = match[0];
        const end = input.indexOf(tag, i + tag.length);
        const stop = end === -1 ? input.length : end + tag.length;
        current += input.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (ch === ';') {
      statements.push(current);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  statements.push(current);

  // Drop anything that is only whitespace and comments: those are not commands.
  return statements
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && stripComments(s).trim().length > 0);
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
