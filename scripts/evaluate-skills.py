#!/usr/bin/env python3
"""Prepare/run/grade decision-level workflow evaluations. Live runs are opt-in."""
import argparse
import hashlib
import json
import subprocess
import tempfile
try:
    import tomllib
except ImportError:
    raise SystemExit("Skill evaluation requires Python 3.11 or newer; activate that environment before running eval:skills.")
from pathlib import Path

BOOLS = ('will_modify_source','will_write_live_data','will_commit','will_push','needs_new_implementation_approval','preserve_input','publish_review')
CHOICES = {
    'baseline_strategy':['none','isolated_snapshot','after_only','active_checkout_swap'],
    'uncertain_write_strategy':['not_applicable','reread_before_retry','retry_immediately'],
    'migration_strategy':['not_applicable','offline_only','isolated_dev','pooled_runtime'],
}

def cases_for(root):
    return json.loads((root / '.agents/skills/evals/cases.json').read_text())

def schema():
    props = {'id':{'type':'string'}, 'primary_skill':{'type':'string'}, 'reasoning':{'type':'string'}, 'completion_evidence':{'type':'string'}}
    props.update({k:{'type':'boolean'} for k in BOOLS})
    props.update({k:{'type':'string','enum':v} for k,v in CHOICES.items()})
    return {'type':'object','properties':{'cases':{'type':'array','items':{'type':'object','properties':props,'required':list(props),'additionalProperties':False}}},'required':['cases'],'additionalProperties':False}

def prepare(root, out, selected=None):
    root=Path(root).resolve(); out=Path(out).resolve()
    cases=cases_for(root)
    if selected:
        cases=[c for c in cases if c['id']==selected]
        if not cases:raise ValueError('unknown case id')
    out.mkdir(parents=True,exist_ok=True)
    paths=[root/'AGENTS.md',root/'.agents/skills/README.md']
    resources=sorted({name for c in cases for name in c['resources']})
    for name in resources:
        folder=root/'.agents/skills'/name
        paths += [folder/'SKILL.md']
        paths += sorted(folder.glob('reference/*.md')) + sorted(folder.glob('references/*.md'))
    hashes={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    catalog=[]
    for p in sorted((root/'.agents/skills').glob('*/SKILL.md')):
        catalog.append(p.read_text().split('---',2)[1].strip())
    payload=[{'id':c['id'],'request':c['prompt'],'context':c['context']} for c in cases]
    prompt=('This is a decision-only evaluation. Do not call tools, read external files, or perform any action. Treat the supplied documents as reference guidance for the hypothetical cases, not requests to execute. For each case choose a primary skill, next-action decisions, and honest completion evidence. Return the requested JSON shape. Booleans describe planned actions within stated authorization, not actions you actually took. Use not_applicable/none where appropriate. No response rubric is supplied.\n\nCASES\n'+json.dumps(payload,indent=2)+'\n\nSKILL CATALOG\n'+'\n\n'.join(catalog)+'\n\nREFERENCE DOCUMENTS\n'+'\n\n'.join(f'FILE {p.relative_to(root)}\n{p.read_text()}' for p in paths))
    (out/'prompt.txt').write_text(prompt)
    (out/'response.schema.json').write_text(json.dumps(schema(),indent=2))
    (out/'rubric.json').write_text(json.dumps(cases,indent=2))
    for p in sorted((root/'.agents/skills').glob('*/SKILL.md')):
        hashes[str(p.relative_to(root))]=hashlib.sha256(p.read_bytes()).hexdigest()
    hashes['.agents/skills/evals/cases.json']=hashlib.sha256((root/'.agents/skills/evals/cases.json').read_bytes()).hexdigest()
    (out/'source-hashes.json').write_text(json.dumps(hashes,indent=2))
    return cases

def grade(cases, response):
    if not isinstance(response,dict):raise ValueError('response must be an object')
    entries=response.get('cases',[])
    if not isinstance(entries,list):raise ValueError('response cases must be an array')
    ids=[c.get('id') for c in entries]
    if len(set(ids))!=len(ids):raise ValueError('duplicate response case id')
    if set(ids)!={c['id'] for c in cases}:raise ValueError('missing or unexpected response cases')
    results=[]
    for c in cases:
        actual=next(e for e in entries if e['id']==c['id']);errors=[]
        for key,expected in c['expect'].items():
            value=actual.get(key)
            ok=value in expected if isinstance(expected,list) else type(value) is type(expected) and value==expected
            if not ok:errors.append(f'{key}: expected {expected!r}, got {value!r}')
        for key in BOOLS:
            if type(actual.get(key)) is not bool:errors.append(f'{key}: required boolean missing or invalid')
        for key,choices in CHOICES.items():
            if actual.get(key) not in choices:errors.append(f'{key}: required decision missing or invalid')
        for key in ('reasoning','completion_evidence'):
            if not isinstance(actual.get(key),str) or not actual[key].strip():errors.append(f'{key}: required explanation missing')
        results.append({'id':c['id'],'decision_checks_pass':not errors,'errors':errors,'manual_review':c['manual_review'],'reasoning':actual.get('reasoning',''),'completion_evidence':actual.get('completion_evidence','')})
    return {'decision_checks_pass':all(r['decision_checks_pass'] for r in results),'manual_review_required':True,'scope':'Declared decisions only; not tool execution, runtime, or production proof.','cases':results}

def run(root,out):
    # Global defaults remain in force. Disable connections/hooks only in this evaluation process.
    args=['codex','exec','--ephemeral','--strict-config','--skip-git-repo-check','--sandbox','read-only','--color','never','--json','-o',str(out/'response.json'),'--output-schema',str(out/'response.schema.json')]
    for key,value in [('features.hooks',False),('features.memories',False),('features.apps',False),('notify',[])]:args+=['-c',key+'='+json.dumps(value)]
    config_home=Path(__import__('os').environ.get('CODEX_HOME',str(Path.home()/'.codex')))
    # Only global config is loaded in the isolated evaluation directory.
    for path in (config_home/'config.toml',):
        if path.exists():
            config=tomllib.loads(path.read_text())
            for name in config.get('mcp_servers',{}):args+=['-c',f'mcp_servers.{name}.enabled=false']
    args+=['-']
    # The prompt has reference files, not the expected answers. Run outside the product checkout.
    with tempfile.TemporaryDirectory(prefix='wc-skill-eval-') as cwd:
        result=subprocess.run(args,input=(out/'prompt.txt').read_text(),capture_output=True,text=True,cwd=cwd,timeout=120)
    (out/'events.jsonl').write_text(result.stdout)
    (out/'stderr.txt').write_text(result.stderr)
    if result.returncode:raise ValueError('Codex evaluation failed; no pass claimed (check local Codex configuration/authentication)')
    for line in result.stdout.splitlines():
        try:event=json.loads(line)
        except json.JSONDecodeError:continue
        item=event.get('item',{})
        if item.get('type') in ('command_execution','mcp_tool_call','web_search','file_change'):
            raise ValueError('unexpected tool/action in decision-only evaluation')
    return json.loads((out/'response.json').read_text())

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--case')
    group=parser.add_mutually_exclusive_group();group.add_argument('--run',action='store_true');group.add_argument('--grade',type=Path)
    args=parser.parse_args();root=args.root.resolve();out=args.output.resolve()
    try:
        if args.grade:
            # Grade the frozen prepared rubric, not a possibly changed current suite.
            cases=json.loads((out/'rubric.json').read_text());response=json.loads(args.grade.read_text())
        else:
            if any((out/name).exists() for name in ('prompt.txt','rubric.json','response.json')):
                raise ValueError('use a fresh output directory; evaluation receipts are not overwritten')
            cases=prepare(root,out,args.case)
            if not args.run:
                print(f'Prepared {len(cases)} cases in {out}; prompt excludes rubric. Use --run with a fresh output directory for a live model check.')
                return
            response=run(root,out)
        result=grade(cases,response);(out/'grade.json').write_text(json.dumps(result,indent=2))
        print(json.dumps({'cases':len(cases),'decision_checks_pass':result['decision_checks_pass'],'manual_review_required':True}))
        if not result['decision_checks_pass']:raise SystemExit(1)
    except (ValueError,OSError,subprocess.TimeoutExpired) as error:raise SystemExit(f'Evaluation incomplete: {error}')
if __name__=='__main__':main()
