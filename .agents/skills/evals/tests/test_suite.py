import importlib.util
import json
import tempfile
import unittest
from unittest import mock
from types import SimpleNamespace
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py')
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
verify=load('verify-skills');evaluate=load('evaluate-skills')
class SuiteTests(unittest.TestCase):
    def fixture(self,root):
        suite=root/'.agents/skills';skill=suite/'sample';skill.mkdir(parents=True)
        (skill/'SKILL.md').write_text('---\nname: sample\ndescription: Sample workflow\n---\nDo useful work.\n')
        (suite/'suite.json').write_text('{"version":1,"aliases":{}}')
        (suite/'evals').mkdir()
        cases=[{'id':'sample','prompt':'Sample request','context':'Sample context','resources':['sample'],'expect':{'primary_skill':['sample'],'will_push':False},'manual_review':['SECRET_RUBRIC_SENTINEL']}]
        (suite/'evals/cases.json').write_text(json.dumps(cases))
        (root/'AGENTS.md').write_text('Local guidance');(suite/'README.md').write_text('Suite')
        return suite,cases
    def test_valid_registry(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.fixture(root);self.assertEqual(verify.check(root)['skills'],1)
    def test_broken_link_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);suite,_=self.fixture(root)
            (suite/'README.md').write_text('[Missing](missing.md)')
            with self.assertRaisesRegex(ValueError,'broken local link'):verify.check(root)
    def test_duplicate_yaml_rejected(self):
        with self.assertRaisesRegex(ValueError,'duplicate YAML'):verify.load_yaml('name: a\nname: b')
    def test_alias_implicit_invocation_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);suite,_=self.fixture(root);alias=suite/'alias';(alias/'agents').mkdir(parents=True)
            (alias/'SKILL.md').write_text('---\nname: alias\ndescription: Alias\n---\n[Canonical](../sample/SKILL.md)')
            (alias/'agents/openai.yaml').write_text('policy:\n  allow_implicit_invocation: true\n')
            (suite/'suite.json').write_text('{"version":1,"aliases":{"alias":"sample"}}')
            with self.assertRaisesRegex(ValueError,'explicit-only'):verify.check(root)
    def test_prompt_excludes_answers_and_records_sources(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.fixture(root);out=root/'out';evaluate.prepare(root,out)
            self.assertNotIn('SECRET_RUBRIC_SENTINEL',(out/'prompt.txt').read_text())
            self.assertIn('SECRET_RUBRIC_SENTINEL',(out/'rubric.json').read_text())
            hashes=json.loads((out/'source-hashes.json').read_text())
            self.assertIn('.agents/skills/sample/SKILL.md',hashes)
    def test_wrong_decision_and_missing_case_fail(self):
        with tempfile.TemporaryDirectory() as d:
            _,cases=self.fixture(Path(d))
            result=evaluate.grade(cases,{'cases':[{'id':'sample','primary_skill':'sample','will_push':True}]})
            self.assertFalse(result['decision_checks_pass'])
            with self.assertRaisesRegex(ValueError,'missing'):evaluate.grade(cases,{'cases':[]})
            with self.assertRaisesRegex(ValueError,'duplicate'):evaluate.grade(cases,{'cases':[{'id':'sample'},{'id':'sample'}]})
class LauncherTests(unittest.TestCase):
    def test_isolated_launcher_disables_only_loaded_global_connectors(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);home=root/'config';home.mkdir()
            (home/'config.toml').write_text('[mcp_servers.global_server]\ncommand="example"\n')
            (root/'.codex').mkdir()
            (root/'.codex/config.toml').write_text('[mcp_servers.project_only]\ncommand="example"\n')
            out=root/'out';out.mkdir();(out/'prompt.txt').write_text('Hypothetical evaluation')
            (out/'response.json').write_text('{"cases":[]}')
            result=SimpleNamespace(returncode=0,stdout='',stderr='diagnostic')
            with mock.patch.dict('os.environ',{'CODEX_HOME':str(home)}), mock.patch.object(evaluate.subprocess,'run',return_value=result) as call:
                evaluate.run(root,out)
            args=call.call_args.args[0]
            self.assertIn('mcp_servers.global_server.enabled=false',args)
            self.assertNotIn('mcp_servers.project_only.enabled=false',args)
            self.assertEqual((out/'stderr.txt').read_text(),'diagnostic')
            self.assertNotEqual(call.call_args.kwargs['cwd'],str(root))
if __name__=='__main__':unittest.main()
