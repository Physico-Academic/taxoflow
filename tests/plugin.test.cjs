const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

class MockPlugin { constructor(app = {}, manifest = {}) { this.app = app; this.manifest = manifest; } }
class MockSettingTab { constructor(app = {}, plugin = {}) { this.app = app; this.plugin = plugin; this.containerEl = {}; } }
class MockModal { constructor(app = {}) { this.app = app; this.contentEl = {}; this.modalEl = {}; } }
class MockSuggest { constructor(app = {}, editor = {}) { this.app = app; this.editor = editor; } }
class MockTFile { constructor(pathname = 'note.md') { this.path = pathname; this.extension = 'md'; } }
const mockObsidian = {
  Plugin: MockPlugin,
  PluginSettingTab: MockSettingTab,
  Modal: MockModal,
  AbstractInputSuggest: MockSuggest,
  TFile: MockTFile,
  Notice: class MockNotice {},
  Setting: class MockSetting {},
  ButtonComponent: class MockButton {},
  TextComponent: class MockText {},
  DropdownComponent: class MockDropdown {},
  ToggleComponent: class MockToggle {},
  parseYaml: () => ({}),
};
const moduleObject = { exports: {} };
const customRequire = name => {
  if (name === 'obsidian') return mockObsidian;
  throw new Error(`Unexpected module import: ${name}`);
};
const appended = `\nmodule.exports.__test = {
  TAXOFLOW_PROPERTY_PREFIX, DEFAULT_SETTINGS, stripPropertyRootPrefix,
  isValidProfileNamespace, matchingProfilesForPropertyKey, getOrphanSelectorKeys,
  isValidProfilePropertyKey, normalizeSelector, normalizeProfile, normalizeSavedSettings,
  parseOptionList, ruleLogic, ruleSpecificity, compareSpecificity, ruleBranches,
  isEmptyPropertyValue, TaxoFlowPlugin, TaxoOptionSuggest,
  normalizeFolderPath, getMatchingProfilesForFrontmatterKeys, resolveTargetFolderForProfiles
};\n`;
new Function('require', 'module', 'exports', source + appended)(customRequire, moduleObject, moduleObject.exports);
const api = moduleObject.exports.__test;

const suiteTests = [
  ['uses the TaxoFlow root prefix', () => assert.equal(api.TAXOFLOW_PROPERTY_PREFIX, 'taxo.')],
  ['fresh settings have no profile', () => assert.deepEqual(api.DEFAULT_SETTINGS, { profiles: [], activeProfileId: '', suppressedAutoRegistrationKeys: [] })],
  ['strips only the current property prefix', () => {
    assert.equal(api.stripPropertyRootPrefix('taxo.book_genre'), 'book_genre');
    assert.equal(api.stripPropertyRootPrefix('selector.book_genre'), 'selector.book_genre');
  }],
  ['accepts TaxoFlow profile namespaces', () => assert.equal(api.isValidProfileNamespace('taxo.book_'), true)],
  ['rejects old-root namespaces', () => assert.equal(api.isValidProfileNamespace('selector.book_'), false)],
  ['rejects a root-only namespace', () => assert.equal(api.isValidProfileNamespace('taxo.'), false)],
  ['matches a property to its configured namespace', () => {
    const profiles = [{ id: 'book', namespace: 'taxo.book_' }, { id: 'country', namespace: 'taxo.country_' }];
    assert.deepEqual(api.matchingProfilesForPropertyKey('taxo.book_genre', profiles).map(p => p.id), ['book']);
  }],
  ['does not match old selector properties to a TaxoFlow profile', () => {
    assert.deepEqual(api.matchingProfilesForPropertyKey('selector.book_genre', [{ namespace: 'taxo.book_' }]), []);
  }],
  ['flags unmapped taxo keys as orphans', () => {
    assert.deepEqual(api.getOrphanSelectorKeys(['taxo.orphan_x', 'title'], []), ['taxo.orphan_x']);
  }],
  ['does not call ordinary properties or old-root keys orphans', () => {
    assert.deepEqual(api.getOrphanSelectorKeys(['title', 'tags', 'selector.book_genre'], []), []);
  }],
  ['validates property suffixes against a profile namespace', () => {
    const profile = { namespace: 'taxo.book_' };
    assert.equal(api.isValidProfilePropertyKey('taxo.book_genre', profile), true);
    assert.equal(api.isValidProfilePropertyKey('taxo.country_name', profile), false);
  }],
  ['normalizes labels without retaining alias fields', () => {
    const selector = api.normalizeSelector({ name: 'taxo.book_genre', label: 'Genre', alias: 'Old value', options: ['Fiction'] });
    assert.equal(selector.label, 'Genre');
    assert.equal(Object.hasOwn(selector, 'alias'), false);
  }],
  ['normalizes profile propertyLabels', () => {
    const profile = api.normalizeProfile({ id: 'book', name: 'Books', namespace: 'taxo.book_', propertyLabels: { 'taxo.book_topic': 'Topic' } });
    assert.equal(profile.propertyLabels['taxo.book_topic'], 'Topic');
    assert.equal(Object.hasOwn(profile, 'propertyAliases'), false);
  }],
  ['does not load legacy propertyAliases into runtime configuration', () => {
    const profile = api.normalizeProfile({ id: 'book', name: 'Books', namespace: 'taxo.book_', propertyAliases: { 'taxo.book_topic': 'Topic' } });
    assert.deepEqual(profile.propertyLabels, {});
  }],
  ['normalizes clean schema-v4 settings', () => {
    const result = api.normalizeSavedSettings({ schemaVersion: 4, activeProfileId: '', profiles: [], suppressedAutoRegistrationKeys: [] });
    assert.deepEqual(result.settings, { profiles: [], activeProfileId: '', suppressedAutoRegistrationKeys: [] });
    assert.equal(result.unsupportedFlatSchema, false);
  }],
  ['normalizes profile defaultFolder', () => {
    const profile = api.normalizeProfile({ id: 'book', name: 'Books', namespace: 'taxo.book_', defaultFolder: '  Notes/Books/  ' });
    assert.equal(profile.defaultFolder, 'Notes/Books/');
    const emptyProfile = api.normalizeProfile({ id: 'book', name: 'Books', namespace: 'taxo.book_' });
    assert.equal(emptyProfile.defaultFolder, '');
  }],
  ['normalizes folder paths safely', () => {
    assert.equal(api.normalizeFolderPath('/Notes/Books/'), 'Notes/Books');
    assert.equal(api.normalizeFolderPath('\\Notes\\Books\\'), 'Notes/Books');
    assert.equal(api.normalizeFolderPath(''), '');
    assert.equal(api.normalizeFolderPath('   '), '');
  }],
  ['matches profiles for frontmatter keys in their namespace', () => {
    const profiles = [
      { id: 'book', namespace: 'taxo.book_', defaultFolder: 'Books' },
      { id: 'recipe', namespace: 'taxo.recipe_', defaultFolder: 'Recipes' }
    ];
    const matched = api.getMatchingProfilesForFrontmatterKeys(['taxo.book_genre', 'taxo.other_key'], profiles);
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, 'book');
  }],
  ['resolves single target folder when only one profile has default folder', () => {
    const profiles = [
      { id: 'book', namespace: 'taxo.book_', defaultFolder: 'Books' },
      { id: 'recipe', namespace: 'taxo.recipe_', defaultFolder: '' }
    ];
    const res = api.resolveTargetFolderForProfiles(profiles);
    assert.equal(res.status, 'single');
    assert.equal(res.folder, 'Books');
  }],
  ['resolves single target folder when multiple profiles share the same folder', () => {
    const profiles = [
      { id: 'book', namespace: 'taxo.book_', defaultFolder: 'Shared/Library' },
      { id: 'author', namespace: 'taxo.author_', defaultFolder: '/Shared/Library/' }
    ];
    const res = api.resolveTargetFolderForProfiles(profiles);
    assert.equal(res.status, 'single');
    assert.equal(res.folder, 'Shared/Library');
  }],
  ['detects conflict when profiles specify different default folders', () => {
    const profiles = [
      { id: 'book', namespace: 'taxo.book_', defaultFolder: 'Books' },
      { id: 'recipe', namespace: 'taxo.recipe_', defaultFolder: 'Recipes' }
    ];
    const res = api.resolveTargetFolderForProfiles(profiles);
    assert.equal(res.status, 'conflict');
    assert.deepEqual(res.folders.sort(), ['Books', 'Recipes']);
    assert.equal(res.profiles.length, 2);
  }],
  ['parses quoted comma values without splitting labels', () => assert.deepEqual(api.parseOptionList('Fiction, "New York, USA"\nScience'), ['Fiction', 'New York, USA', 'Science'])],
  ['rule specificity is deterministic', () => {
    const specific = { logic: 'and', when: { 'taxo.book_mode': ['Fiction'], 'taxo.book_genre': ['Novel'] } };
    const broad = { logic: 'and', when: { 'taxo.book_mode': ['Fiction'] } };
    assert.ok(api.compareSpecificity(specific, broad) < 0);
  }],
  ['recognizes empty values without treating non-empty values as empty', () => {
    assert.equal(api.isEmptyPropertyValue('  '), true);
    assert.equal(api.isEmptyPropertyValue([]), true);
    assert.equal(api.isEmptyPropertyValue('Fiction'), false);
    assert.equal(api.isEmptyPropertyValue(['Fiction']), false);
  }],
  ['source names the rebranded plugin class', () => assert.match(source, /class TaxoFlowPlugin extends obsidian_1\.Plugin/)],
  ['source uses the type-aware suggestion refresh implementation', () => {
    assert.match(source, /getPropertyTypeSignature/);
    assert.match(source, /propertyTypeChanged/);
  }],
  ['source includes pointer capture and pointer cleanup for modals', () => {
    assert.match(source, /setPointerCapture/);
    assert.match(source, /pointercancel/);
    assert.match(source, /lostpointercapture/);
  }],
  ['source does not contain Bases-specific integration', () => {
    assert.doesNotMatch(source, /\.bases-th|bases-json|Bases-specific/i);
  }],
  ['runtime source does not contain old branding or root prefix literals', () => {
    assert.doesNotMatch(source, /Custom Selectors|custom-selectors|["']selector\./);
  }],
  ['runtime label schema has no alias persistence fields', () => {
    assert.doesNotMatch(source, /propertyAliases|raw\?\.alias|selector\.alias/);
  }],
  ['shipped JS and CSS do not contain comment markers', () => {
    for (const file of ['main.js', 'styles.css']) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      assert.doesNotMatch(text, /\/\/|\/\*|\*\//, `${file} should have zero comments`);
    }
  }],
];

for (const [name, run] of suiteTests) test(name, run);


test('property type resolver supports Map-based Obsidian type metadata', () => {
  const instance = Object.create(api.TaxoFlowPlugin.prototype);
  instance.app = { metadataTypeManager: { properties: new Map([['taxo.book_genre', { type: 'List' }]]) } };
  assert.equal(instance.getCorePropertyType('taxo.book_genre'), 'list');
});

test('property type resolver matches metadata keys case-insensitively', () => {
  const instance = Object.create(api.TaxoFlowPlugin.prototype);
  instance.app = { metadataTypeManager: { properties: { 'TAXO.BOOK_GENRE': { type: 'Text' } } } };
  assert.equal(instance.getCorePropertyType('taxo.book_genre'), 'text');
});

test('active property DOM type takes precedence over stale metadata', () => {
  const instance = Object.create(api.TaxoFlowPlugin.prototype);
  instance.app = { metadataTypeManager: { properties: { 'taxo.book_genre': { type: 'list' } } } };
  const valueContainer = { getAttribute: () => null, querySelector: () => null };
  const property = {
    getAttribute: name => name === 'data-property-type' ? 'Text' : null,
    querySelector: selector => selector === '.metadata-property-value' ? valueContainer : null
  };
  const context = { closest: selector => selector === '.metadata-property' ? property : null };
  assert.equal(instance.getCorePropertyType('taxo.book_genre', context), 'text');
});

test('assigned Text type wins over array-shaped cached frontmatter', () => {
  const instance = Object.create(api.TaxoFlowPlugin.prototype);
  instance.app = {
    metadataTypeManager: { properties: { 'taxo.book_genre': { type: 'text' } } },
    metadataCache: { getFileCache: () => ({ frontmatter: { 'taxo.book_genre': ['X'] } }) }
  };
  instance.getFileForContext = () => ({ path: 'note.md' });
  assert.equal(instance.isListProperty('taxo.book_genre', null, 'preview'), false);
});

test('List suggestions hide already-selected values case-insensitively', () => {
  global.HTMLElement ||= class HTMLElement {};
  const suggest = Object.create(api.TaxoOptionSuggest.prototype);
  Object.assign(suggest, {
    suggestEl: null, suggestions: null, optionsProvider: () => ['X', 'Y'],
    listProperty: () => true, selectedValuesProvider: () => ['x'],
    showAllUntilTyped: false, valueAtOpen: '', readEditorValue: () => '', limit: 100
  });
  assert.deepEqual(suggest.getSuggestions(''), ['Y']);
});

test('Text suggestions retain the current value so choosing another option replaces it', () => {
  global.HTMLElement ||= class HTMLElement {};
  const suggest = Object.create(api.TaxoOptionSuggest.prototype);
  Object.assign(suggest, {
    suggestEl: null, suggestions: null, optionsProvider: () => ['X', 'Y'],
    listProperty: () => false, selectedValuesProvider: () => ['X'],
    showAllUntilTyped: false, valueAtOpen: 'X', readEditorValue: () => 'X', limit: 100
  });
  assert.deepEqual(suggest.getSuggestions(''), ['X', 'Y']);
});

test('applying a default does not overwrite a non-empty Text value', async () => {
  const instance = Object.create(api.TaxoFlowPlugin.prototype);
  const file = { path: 'books/one.md' };
  const frontmatter = { 'taxo.book_genre': 'Existing value' };
  instance.getKnownOptionsForSelector = () => ['Default option'];
  instance.scanPropertyOccurrences = async () => [{ path: file.path, file }];
  instance.getCorePropertyType = () => 'text';
  instance.getOptionsForFrontmatter = () => ['Default option'];
  instance.processFrontMatterSerialized = async (_file, mutator) => mutator(frontmatter);
  instance.scheduleSettingsInventoryRefresh = () => {};
  const result = await instance.applyDefaultToExistingInstances({ name: 'taxo.book_genre', defaultValue: 'Default option' });
  assert.equal(result.updated, 0);
  assert.equal(frontmatter['taxo.book_genre'], 'Existing value');
});

test('applying a default only fills an empty Text property', async () => {
  const instance = Object.create(api.TaxoFlowPlugin.prototype);
  const file = { path: 'books/one.md' };
  const frontmatter = { 'taxo.book_genre': '' };
  instance.getKnownOptionsForSelector = () => ['Fiction'];
  instance.scanPropertyOccurrences = async () => [{ path: file.path, file }];
  instance.getCorePropertyType = () => 'text';
  instance.getOptionsForFrontmatter = () => ['Fiction'];
  instance.processFrontMatterSerialized = async (_file, mutator) => mutator(frontmatter);
  instance.scheduleSettingsInventoryRefresh = () => {};
  const result = await instance.applyDefaultToExistingInstances({ name: 'taxo.book_genre', defaultValue: 'Fiction' });
  assert.equal(result.updated, 1);
  assert.equal(frontmatter['taxo.book_genre'], 'Fiction');
});

test('applying a default only fills an empty List property and stores an array', async () => {
  const instance = Object.create(api.TaxoFlowPlugin.prototype);
  const file = { path: 'books/two.md' };
  const frontmatter = { 'taxo.book_genre': [] };
  instance.getKnownOptionsForSelector = () => ['Fiction'];
  instance.scanPropertyOccurrences = async () => [{ path: file.path, file }];
  instance.getCorePropertyType = () => 'list';
  instance.getOptionsForFrontmatter = () => ['Fiction'];
  instance.processFrontMatterSerialized = async (_file, mutator) => mutator(frontmatter);
  instance.scheduleSettingsInventoryRefresh = () => {};
  const result = await instance.applyDefaultToExistingInstances({ name: 'taxo.book_genre', defaultValue: 'Fiction' });
  assert.equal(result.updated, 1);
  assert.deepEqual(frontmatter['taxo.book_genre'], ['Fiction']);
});

test('a default invalid in the current dependency context is skipped', async () => {
  const instance = Object.create(api.TaxoFlowPlugin.prototype);
  const file = { path: 'books/three.md' };
  const frontmatter = { 'taxo.book_type': '' };
  instance.getKnownOptionsForSelector = () => ['Textbook', 'Novel'];
  instance.scanPropertyOccurrences = async () => [{ path: file.path, file }];
  instance.getCorePropertyType = () => 'text';
  instance.getOptionsForFrontmatter = () => ['Novel'];
  instance.processFrontMatterSerialized = async (_file, mutator) => mutator(frontmatter);
  instance.scheduleSettingsInventoryRefresh = () => {};
  const result = await instance.applyDefaultToExistingInstances({ name: 'taxo.book_type', defaultValue: 'Textbook' });
  assert.equal(result.updated, 0);
  assert.equal(result.invalidContext, 1);
  assert.equal(frontmatter['taxo.book_type'], '');
});

test('moveNoteToFolder recognizes when file is already at target folder root', async () => {
  const instance = Object.create(api.TaxoFlowPlugin.prototype);
  const file = new mockObsidian.TFile('Books/one.md');
  file.name = 'one.md';
  const result = await instance.moveNoteToFolder(file, 'Books');
  assert.equal(result.success, true);
  assert.equal(result.alreadyThere, true);
});

test('moveNoteToFolder targets root of folder when note is in a subfolder', async () => {
  const instance = Object.create(api.TaxoFlowPlugin.prototype);
  const file = new mockObsidian.TFile('Books/Subfolder/one.md');
  file.name = 'one.md';
  let renamedTo = null;
  instance.app = {
    vault: {
      getAbstractFileByPath: (path) => path === 'Books' ? { path: 'Books' } : null,
      createFolder: async () => {},
    },
    fileManager: {
      renameFile: async (_file, target) => { renamedTo = target; file.path = target; },
    },
  };
  const result = await instance.moveNoteToFolder(file, 'Books');
  assert.equal(result.success, true);
  assert.equal(renamedTo, 'Books/one.md');
});

test('moveNoteToFolder skips move when destination filename collides', async () => {
  const instance = Object.create(api.TaxoFlowPlugin.prototype);
  const file = new mockObsidian.TFile('Inbox/one.md');
  file.name = 'one.md';
  const existing = new mockObsidian.TFile('Books/one.md');
  instance.app = {
    vault: {
      getAbstractFileByPath: (path) => {
        if (path === 'Books') return { path: 'Books' };
        if (path === 'Books/one.md') return existing;
        return null;
      },
      createFolder: async () => {},
    },
    fileManager: {
      renameFile: async () => { throw new Error('Should not be called'); },
    },
  };
  const result = await instance.moveNoteToFolder(file, 'Books');
  assert.equal(result.success, false);
  assert.equal(result.reason, 'collision');
});
