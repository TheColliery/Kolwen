// Witnesses for the slot positions the template build refuses (scripts/lib/page-template.mjs): a catalogue slot in a tag name, in an
// open or a close tag, and in an attribute name is refused and named as such; a text slot and an attribute-value slot are the places
// a catalogue value may stand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { templateProblems, withoutComments } from './lib/page-template.mjs';

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

test('a catalogue slot later in a tag name is refused by name, in an open tag and in a close tag', () => {
  const problems = templateProblems('<main><p><scr{{shared.k}}>x</scr{{shared.k}}></p></main>', 'probe');
  assert.ok(problems.some(p => /a tag name holds a slot/.test(p)), problems.join('\n'));
});

test('a catalogue slot later in a close tag name alone is refused by name', () => {
  const problems = templateProblems('<main><p>x</scr{{shared.k}}></p></main>', 'probe');
  assert.ok(problems.some(p => /a tag name holds a slot/.test(p)), problems.join('\n'));
});

test('a slot inside a quoted attribute value is not a tag name, so it is not refused as one', () => {
  const problems = templateProblems('<main><p title="<scr{{shared.k}}>">A</p></main>', 'probe');
  assert.ok(!problems.some(p => /a tag name holds a slot/.test(p)), problems.join('\n'));
});

test('a slot inside a comment is not a tag name, so it is not refused as one', () => {
  const problems = templateProblems('<main><!-- <scr{{shared.k}}> --><p>A</p></main>', 'probe');
  assert.ok(!problems.some(p => /a tag name holds a slot/.test(p)), problems.join('\n'));
});

test('a no-break space does not end a tag name: a slot after one is refused by name', () => {
  const problems = templateProblems('<main><scr {{shared.k}}>A</scr></main>', 'probe');
  assert.ok(problems.some(p => /a tag name holds a slot/.test(p)), problems.join('\n'));
});

test('a slot at the start of an opening tag name is refused by name', () => {
  const problems = templateProblems('<main><{{x.tag}}>A</main>', 'probe');
  assert.ok(problems.some(p => /a tag name holds a slot/.test(p)), problems.join('\n'));
});

test('a slot later in an opening tag name is refused by name', () => {
  const problems = templateProblems('<main><p class="a"><scr{{x.k}}>A</p></main>', 'probe');
  assert.ok(problems.some(p => /a tag name holds a slot/.test(p)), problems.join('\n'));
});

test('the comment strip leaves no comment opener behind, and an unclosed comment cuts to the end', () => {
  for (const s of ['<!<!--x-->--', '<!--a<!--b-->c-->', '<!-- never closed <p>']) assert.doesNotMatch(withoutComments(s), /<!--/, s);
  assert.equal(withoutComments('<!-- never closed <p>'), '');
});
