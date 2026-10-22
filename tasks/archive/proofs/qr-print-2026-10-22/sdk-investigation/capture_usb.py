"""Passive Brother USB capture; load only after separately approved attachment.
No print/feed/status calls, target writes, expressions, app edits, or security changes.
"""
import hashlib
import json
import os
import time
import uuid
import lldb

LOG_PATH = '/private/tmp/qr-native-usb-capture/usb-events.jsonl'
SDK_PATH = '/Applications/P-touch Editor.app/Contents/Frameworks/MacPrintSDK.framework/Versions/A/MacPrintSDK'
EXE_PATH = '/Applications/P-touch Editor.app/Contents/MacOS/P-touch Editor'
SDK_SHA256 = '3b958667dc02b7236caad63bb27656c36fe6d57a70aea6ecd1fdf96d5506e85b'
SDK_UUID = 'DFFD3A57-7846-395A-97CA-8355CA009F0D'
MAX_BYTES = 2 * 1024 * 1024
MAX_EVENTS = 5000
MAX_BUFFER = 1024 * 1024
MAX_PENDING = 64
WINDOW_SECONDS = 90
_target = None
_owned = set()
_entries = set()
_admission_closed = None
_out_overlap = False
_pending = {}
_log = None
_events = 0
_bytes = 0
_calls = 0
_session = None
_deadline = 0


def emit(kind, **fields):
    global _events
    if _log is None:
        return
    if _events >= MAX_EVENTS:
        raise RuntimeError('Capture event budget exhausted')
    _events += 1
    _log.write(json.dumps({'session': _session, 'time_ns': time.time_ns(), 'kind': kind, **fields}) + '\n')
    _log.flush()


def finish(reason, error=None):
    global _target, _log
    target = _target
    _target = None
    # Cleanup precedes logging so a disk/logging failure cannot leave traps armed.
    if target is not None:
        for bp_id in list(_owned):
            target.BreakpointDelete(bp_id)
    _owned.clear()
    _entries.clear()
    unfinished = [call['call_id'] for call in _pending.values()]
    _pending.clear()
    try:
        emit('capture_end', reason=reason, error=error, total_bytes=_bytes,
             events_before_end=_events, unfinished_calls=unfinished,
             overlapping_out_detected=_out_overlap)
    finally:
        if _log is not None:
            try:
                _log.close()
            finally:
                _log = None


def reg(frame, name):
    value = frame.FindRegister(name)
    if not value.IsValid():
        raise RuntimeError('Missing ARM64 register: ' + name)
    return value.GetValueAsUnsigned()


def memory(process, address, size):
    error = lldb.SBError()
    data = process.ReadMemory(address, size, error)
    if not error.Success() or len(data) != size:
        return None, str(error)
    return data.hex(), None


def stop_admission(reason):
    global _admission_closed
    if _admission_closed is not None:
        return
    _admission_closed = reason
    for bp_id in list(_entries):
        _target.BreakpointDelete(bp_id)
        _owned.discard(bp_id)
    _entries.clear()
    emit('admission_stopped', reason=reason, pending_calls=len(_pending))
    if not _pending:
        finish(reason)


def complete_call(bp_id):
    _pending.pop(bp_id)
    if _admission_closed is not None and not _pending:
        finish(_admission_closed)


def budget(admit_new=True):
    if time.monotonic() >= _deadline:
        finish('window_expired')
        return False
    if not admit_new:
        # Accepted calls own reserved result slots; byte/pending admission limits
        # must not discard their scalar return values.
        return True
    if _admission_closed is not None:
        return False
    if _events + len(_pending) + 4 >= MAX_EVENTS or len(_pending) >= MAX_PENDING:
        stop_admission('event_or_pending_limit')
        return False
    if _bytes >= MAX_BYTES:
        stop_admission('byte_limit')
        return False
    return True


def enter(frame, bp_loc, internal_dict):
    try:
        return enter_impl(frame, bp_loc)
    except Exception as error:
        try:
            finish('capture_error', str(error))
        except Exception:
            pass
        return False


def enter_impl(frame, bp_loc):
    global _bytes, _calls, _out_overlap
    if _target is None or not budget():
        return False
    if (frame.GetModule().GetUUIDString() or '').upper() != SDK_UUID:
        finish('unexpected_module')
        return False
    name = frame.GetFunctionName() or ''
    thread = frame.GetThread()
    process = thread.GetProcess()
    _calls += 1
    call = {'call_id': _calls, 'direction': 'out' if 'write:size:' in name else 'in',
            'thread': thread.GetThreadID(), 'function': name,
            'entry_sp': reg(frame, 'sp'), 'interface': reg(frame, 'x0')}
    if call['direction'] == 'out':
        overlaps = [old['call_id'] for old in _pending.values() if old['direction'] == 'out' and old['interface'] == call['interface']]
        if overlaps:
            _out_overlap = True
            emit('out_overlap_unordered', call_id=call['call_id'], other_calls=overlaps)
        call.update(address=reg(frame, 'x2'), requested=reg(frame, 'w3'))
        length = call['requested']
        if length > MAX_BUFFER or length > MAX_BYTES - _bytes:
            emit('oversize_buffer', **call)
            stop_admission('buffer_limit')
            return False
        data, error = memory(process, call['address'], length)
        _bytes += length if data is not None else 0
        emit('write_entry', **call, hex=data, read_error=error)
    else:
        call.update(address=reg(frame, 'x4'), size_pointer=reg(frame, 'x5'), pipe=reg(frame, 'x3'))
        raw, error = memory(process, call['size_pointer'], 4)
        call['requested'] = int.from_bytes(bytes.fromhex(raw), 'little') if raw is not None else None
        emit('read_entry', **call, size_error=error)
    ret = _target.BreakpointCreateByAddress(reg(frame, 'lr'))
    _owned.add(ret.GetID())
    ret.SetThreadID(thread.GetThreadID())
    # Keep until this invocation's SP returns: SDK reads can reenter through a run loop.
    ret.SetScriptCallbackFunction(__name__ + '.returned')
    _pending[ret.GetID()] = call
    return False


def returned(frame, bp_loc, internal_dict):
    try:
        return returned_impl(frame, bp_loc)
    except Exception as error:
        try:
            finish('capture_error', str(error))
        except Exception:
            pass
        return False


def returned_impl(frame, bp_loc):
    global _bytes
    if _target is None:
        return False
    bp_id = bp_loc.GetBreakpoint().GetID()
    call = _pending.get(bp_id)
    if call is None or reg(frame, 'sp') != call['entry_sp']:
        return False
    if not budget(admit_new=False):
        return False
    _owned.discard(bp_id)
    _target.BreakpointDelete(bp_id)
    result = reg(frame, 'x0')
    if call['direction'] == 'out':
        emit('write_return', **call, return_register=result)
        complete_call(bp_id)
        return False
    if result != 0:
        # Exact SDK timeout/error paths leave capacity unchanged; no IN bytes are valid.
        emit('read_return_error', **call, return_register=result)
        complete_call(bp_id)
        return False
    process = frame.GetThread().GetProcess()
    raw, error = memory(process, call['size_pointer'], 4)
    actual = int.from_bytes(bytes.fromhex(raw), 'little') if raw is not None else None
    if actual is None or call['requested'] is None or actual > call['requested']:
        emit('read_return_invalid_size', **call, actual=actual, size_error=error, return_register=result)
        complete_call(bp_id)
        return False
    if actual > MAX_BUFFER or actual > MAX_BYTES - _bytes:
        emit('read_return_oversize', **call, actual=actual, return_register=result)
        finish('buffer_limit')
        return False
    data, error = memory(process, call['address'], actual)
    _bytes += actual if data is not None else 0
    emit('read_return', **call, actual=actual, hex=data, read_error=error, return_register=result)
    complete_call(bp_id)
    return False


def start(debugger, command, result, internal_dict):
    global _target, _log, _events, _bytes, _calls, _session, _deadline, _admission_closed, _out_overlap
    if _target is not None or _log is not None or _owned:
        result.SetError('A capture is already armed; stop it first.')
        return
    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    if process.GetState() != lldb.eStateStopped:
        result.SetError('Requires a separately approved, stopped attachment.')
        return
    if not target.GetTriple().startswith('arm64-apple-'):
        result.SetError('Only the verified ARM64 ABI is supported.')
        return
    if os.path.realpath(target.GetExecutable().fullpath) != EXE_PATH:
        result.SetError('Refusing an executable other than the selected P-touch app.')
        return
    sdk = next((m for m in target.module_iter() if os.path.realpath(m.GetFileSpec().fullpath) == SDK_PATH), None)
    if sdk is None or (sdk.GetUUIDString() or '').upper() != SDK_UUID:
        result.SetError('The selected SDK module does not match the reviewed target.')
        return
    with open(SDK_PATH, 'rb') as source:
        if hashlib.sha256(source.read()).hexdigest() != SDK_SHA256:
            result.SetError('SDK file changed; review it before capture.')
            return
    _events = _bytes = _calls = 0
    _admission_closed = None
    _out_overlap = False
    _session = str(uuid.uuid4())
    _deadline = time.monotonic() + WINDOW_SECONDS
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW
    fd = os.open(LOG_PATH, flags, 0o600)
    _log = os.fdopen(fd, 'a', buffering=1)
    _target = target
    try:
        emit('capture_start', pid=process.GetProcessID(), scope='SDK USB only',
             byte_limit=MAX_BYTES, event_limit=MAX_EVENTS, window_seconds=WINDOW_SECONDS)
        for name in ('-[BSMIOKitUSBInterface write:size:]', '-[BSMIOKitUSBInterface read:pipeRef:buffer:size:timeout:interval:]'):
            bp = target.BreakpointCreateByName(name)
            _owned.add(bp.GetID())
            _entries.add(bp.GetID())
            if bp.GetNumLocations() != 1 or (bp.GetLocationAtIndex(0).GetAddress().GetModule().GetUUIDString() or '').upper() != SDK_UUID:
                raise RuntimeError('Expected one exact reviewed SDK method: ' + name)
            bp.SetScriptCallbackFunction(__name__ + '.enter')
            emit('breakpoint', name=name, locations=bp.GetNumLocations())
        result.AppendMessage('Capture armed for up to 90 seconds of USB activity. Continue, print only the reviewed two-label job, interrupt after completion, qr_usb_stop, detach.')
    except Exception as error:
        try:
            finish('setup_error', str(error))
        finally:
            result.SetError(str(error))


def stop(debugger, command, result, internal_dict):
    finish('operator_stop')
    result.AppendMessage('Owned capture breakpoints removed. No print/feed/status operation was sent. Detach next.')


def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand('command script add -f ' + __name__ + '.start qr_usb_start')
    debugger.HandleCommand('command script add -f ' + __name__ + '.stop qr_usb_stop')
