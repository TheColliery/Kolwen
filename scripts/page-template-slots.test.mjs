// Witnesses for the slot positions the template build refuses (scripts/lib/page-template.mjs): a catalogue slot in a tag name, in an
// open or a close tag, and in an attribute name is refused and named as such; a text slot and an attribute-value slot are the places
// a catalogue value may stand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { templateProblems } from './lib/page-template.mjs';

test('a catalogue slot in an open and a close tag name is refused by name', () => {
  const problems = templateProblems('<main><{{x.tag}}>A</{{x.tag}}></main>', 'probe');
  assert.ok(problems.some(p => /a tag name holds a slot/.test(p)), problems.join('\n'));
});

test('a catalogue slot in a close tag name alone is refused by name', () => {
  const problems = templateProblems('<main><p>A</{{x.tag}}></main>', 'probe');
  assert.ok(problems.some(p => /a tag name holds a slot/.test(p)), problems.join('\n'));
});

test('a catalogue slot in an attribute name is refused by name', () => {
  const problems = templateProblems('<main><div {{x.attr}}="v">A</div></main>', 'probe');
  assert.ok(problems.some(p => /attribute name that holds a slot/.test(p)), problems.join('\n'));
});

test('a text slot and an attribute-value slot are the places a catalogue value stands', () => {
  assert.deepEqual(templateProblems('<main><p class="{{=x.c}}">{{x.a}}</p></main>', 'probe'), []);
});
