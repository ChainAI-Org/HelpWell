/**
 * The owner's greeting: Liquid-style placeholders, like personalised email,
 * and the original single braces, which keep working.
 */

import { describe, expect, it } from 'vitest';
import { fillGreeting } from '../src/greeting.js';

const anonymous = { product: 'Acme', firstName: null };
const ada = { product: 'Acme', firstName: 'Ada' };

describe('fillGreeting', () => {
  it('fills the Liquid spelling, with or without spaces, and the short names', () => {
    expect(fillGreeting('Hi {{ contact.first_name }}, welcome to {{ product.name }}', ada)).toBe(
      'Hi Ada, welcome to Acme',
    );
    expect(fillGreeting('{{contact.first_name}} / {{product.name}}', ada)).toBe('Ada / Acme');
    expect(fillGreeting('{{ first_name }} and {{ product }}', ada)).toBe('Ada and Acme');
  });

  it('keeps the original single braces working', () => {
    expect(fillGreeting('Welcome, {first_name}. Ask about {product}.', ada)).toBe(
      'Welcome, Ada. Ask about Acme.',
    );
    expect(fillGreeting('Welcome, {first_name}', anonymous)).toBe('Welcome, there');
  });

  it('says "there" for an unknown visitor, unless the placeholder names its own fallback', () => {
    expect(fillGreeting('Hi {{ contact.first_name }}', anonymous)).toBe('Hi there');
    expect(fillGreeting('Hi {{ contact.first_name | default: "friend" }}', anonymous)).toBe(
      'Hi friend',
    );
    expect(fillGreeting("Hi {{ contact.first_name | default: 'pal' }}", anonymous)).toBe('Hi pal');
    expect(fillGreeting('Hi {{ first_name | friend }}', anonymous)).toBe('Hi friend');
    expect(fillGreeting('Hi {{ first_name | default }}', anonymous)).toBe('Hi there');
    expect(fillGreeting('Hi{{ contact.first_name | default: "" }}!', anonymous)).toBe('Hi!');
    // A known visitor's name wins over the fallback.
    expect(fillGreeting('Hi {{ contact.first_name | default: "friend" }}', ada)).toBe('Hi Ada');
  });

  it('leaves anything else in braces as written', () => {
    expect(fillGreeting('{{ contact.email }} {company} {{ workspace.name }}', ada)).toBe(
      '{{ contact.email }} {company} {{ workspace.name }}',
    );
    expect(fillGreeting('No placeholders here', ada)).toBe('No placeholders here');
  });

  it('fills in one pass: a value with braces in it is never read as a placeholder', () => {
    expect(
      fillGreeting('{product} {first_name}', {
        product: '{first_name}',
        firstName: '{{ product }}',
      }),
    ).toBe('{first_name} {{ product }}');
    expect(fillGreeting('{{ product.name }}', { product: '$& $1', firstName: null })).toBe('$& $1');
  });
});
