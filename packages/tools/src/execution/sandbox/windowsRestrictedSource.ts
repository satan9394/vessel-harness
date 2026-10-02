/** Clean-room Win32 launcher. A suspended restricted child enters a kill-on-close Job before resume. */
export const WINDOWS_RESTRICTED_SOURCE = String.raw`
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

public static class VesselRestricted {
  [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int Length; public IntPtr Descriptor; public int Inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string reserved, desktop, title; public uint x,y,xsize,ysize,xchars,ychars,fill,flags; public ushort show,reserved2; public IntPtr reservedPtr,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMITS { public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong r,w,o,rb,wb,ob; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMITS { public BASIC_LIMITS basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct GENERIC_MAPPING { public uint Read,Write,Execute,All; }
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint access,out IntPtr token);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSidToSid(string sid,out IntPtr p);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr token,uint flags,uint disabled,[In] SID_AND_ATTRIBUTES[] disable,uint deleted,IntPtr privileges,uint count,[In] SID_AND_ATTRIBUTES[] restrict,out IntPtr result);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool SetTokenInformation(IntPtr token,int kind,ref SID_AND_ATTRIBUTES data,int size);
  [DllImport("advapi32.dll")] static extern int GetLengthSid(IntPtr sid);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool DuplicateTokenEx(IntPtr token,uint access,IntPtr attrs,int level,int type,out IntPtr result);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode)] static extern uint GetNamedSecurityInfo(string name,int kind,uint flags,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr sd);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr sd,uint rev,uint info,out IntPtr text,out uint length);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool AccessCheck(IntPtr sd,IntPtr token,uint access,ref GENERIC_MAPPING mapping,IntPtr privilege,ref uint length,out uint granted,out bool status);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SECURITY_ATTRIBUTES attrs,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr h,uint mask,uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED_LIMITS limits,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessAsUser(IntPtr token,string app,StringBuilder command,IntPtr processAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO startup,out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint timeout);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr h,out uint code);
  public class Result { public string Stdout,Stderr; public int ExitCode; public bool Enforced; }
  static void Check(bool value,string operation) { if(!value) throw new Win32Exception(Marshal.GetLastWin32Error(),operation); }
  static string Quote(string s) {
    var result=new StringBuilder("\""); int slashes=0;
    foreach(char c in s) {
      if(c=='\\') { slashes++; continue; }
      result.Append('\\',c=='"'?slashes*2+1:slashes).Append(c); slashes=0;
    }
    return result.Append('\\',slashes*2).Append('"').ToString();
  }
  static string ReadBounded(IntPtr handle) {
    using(var stream=new FileStream(new SafeFileHandle(handle,true),FileAccess.Read))
    using(var reader=new StreamReader(stream,Encoding.UTF8)) {
      var text=new StringBuilder(); var buffer=new char[4096]; int n;
      while((n=reader.Read(buffer,0,buffer.Length))>0) { int keep=Math.Min(n,65536-text.Length); if(keep>0) text.Append(buffer,0,keep); }
      return text.ToString();
    }
  }
  static void CheckRoot(string root,string sid,IntPtr token) {
    IntPtr owner,group,dacl,sacl,sd,text=IntPtr.Zero; uint length;
    uint error=GetNamedSecurityInfo(root,1,4|16,out owner,out group,out dacl,out sacl,out sd);
    if(error!=0) throw new Win32Exception((int)error,"sandbox ACL preflight");
    try {
      Check(ConvertSecurityDescriptorToStringSecurityDescriptor(sd,1,4|16,out text,out length),"sandbox SDDL");
      string sddl=Marshal.PtrToStringUni(text);
      // Low label plus inheritable, explicit restricted SID grant. AccessCheck validates the effective token.
      if(!sddl.Contains("(ML;OICI;NW;;;LW)") || !sddl.Contains(";;;"+sid+")")) throw new InvalidOperationException("sandbox directory requires provisioned Low Integrity and restricted SID ACL: "+root);
      var mapping=new GENERIC_MAPPING {Read=0x120089,Write=0x120116,Execute=0x1200A0,All=0x1F01FF};
      IntPtr privileges=Marshal.AllocHGlobal(4096); uint size=4096, granted; bool status;
      try { Check(AccessCheck(sd,token,0x120116,ref mapping,privileges,ref size,out granted,out status),"sandbox write AccessCheck"); if(!status) throw new InvalidOperationException("sandbox restricted write access denied: "+root); }
      finally { Marshal.FreeHGlobal(privileges); }
    } finally { if(text!=IntPtr.Zero) LocalFree(text); LocalFree(sd); }
  }
  public static Result Run(string command,string[] args,string cwd,string[] roots,string sid,ulong memory,uint timeout) {
    IntPtr original=IntPtr.Zero,token=IntPtr.Zero,impersonation=IntPtr.Zero,admin=IntPtr.Zero,restrict=IntPtr.Zero,low=IntPtr.Zero,job=IntPtr.Zero,ro=IntPtr.Zero,wo=IntPtr.Zero,re=IntPtr.Zero,we=IntPtr.Zero;
    var process=new PROCESS_INFORMATION();
    try {
      Check(OpenProcessToken(GetCurrentProcess(),0xB,out original),"OpenProcessToken");
      Check(ConvertStringSidToSid("S-1-5-32-544",out admin),"admin SID");
      Check(ConvertStringSidToSid(sid,out restrict),"restricted SID");
      // DISABLE_MAX_PRIVILEGE | WRITE_RESTRICTED. Administrators become deny-only; read access remains normal.
      Check(CreateRestrictedToken(original,1|8,1,new[]{new SID_AND_ATTRIBUTES{Sid=admin}},0,IntPtr.Zero,1,new[]{new SID_AND_ATTRIBUTES{Sid=restrict}},out token),"CreateRestrictedToken");
      Check(ConvertStringSidToSid("S-1-16-4096",out low),"Low Integrity SID");
      var label=new SID_AND_ATTRIBUTES{Sid=low,Attributes=0x20};
      Check(SetTokenInformation(token,25,ref label,Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES))+GetLengthSid(low)),"SetTokenIntegrityLevel");
      Check(DuplicateTokenEx(token,0x20008,IntPtr.Zero,2,2,out impersonation),"DuplicateTokenEx");
      foreach(string root in roots) CheckRoot(root,sid,impersonation);
      job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero,"CreateJobObject");
      var limits=new EXTENDED_LIMITS(); limits.basic.flags=0x2000|0x100|0x8|0x2; limits.basic.active=64; limits.basic.processTime=(long)timeout*10000; limits.processMemory=new UIntPtr(memory);
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMITS))),"SetInformationJobObject");
      var attrs=new SECURITY_ATTRIBUTES{Length=Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)),Inherit=1};
      Check(CreatePipe(out ro,out wo,ref attrs,0),"stdout pipe"); Check(CreatePipe(out re,out we,ref attrs,0),"stderr pipe");
      Check(SetHandleInformation(ro,1,0),"stdout inheritance"); Check(SetHandleInformation(re,1,0),"stderr inheritance");
      var startup=new STARTUPINFO{cb=Marshal.SizeOf(typeof(STARTUPINFO)),flags=0x100,output=wo,error=we};
      var argv=new StringBuilder(Quote(command)); foreach(string arg in args) argv.Append(" ").Append(Quote(arg));
      Check(CreateProcessAsUser(token,null,argv,IntPtr.Zero,IntPtr.Zero,true,0x4|0x8000000,IntPtr.Zero,cwd,ref startup,out process),"CreateProcessAsUser");
      Check(AssignProcessToJobObject(job,process.process),"AssignProcessToJobObject");
      CloseHandle(wo); wo=IntPtr.Zero; CloseHandle(we); we=IntPtr.Zero;
      IntPtr outHandle=ro,errHandle=re; ro=re=IntPtr.Zero;
      var stdout=Task.Run(()=>ReadBounded(outHandle)); var stderr=Task.Run(()=>ReadBounded(errHandle));
      Check(ResumeThread(process.thread)!=0xFFFFFFFF,"ResumeThread");
      bool timedOut=WaitForSingleObject(process.process,timeout)!=0;
      if(timedOut) Check(TerminateJobObject(job,124),"timeout TerminateJobObject");
      uint code; Check(GetExitCodeProcess(process.process,out code),"GetExitCodeProcess");
      // Close descendants even when the root exits, so inherited stdout handles cannot keep this launcher alive.
      Check(TerminateJobObject(job,code),"TerminateJobObject");
      return new Result{Stdout=stdout.Result,Stderr=stderr.Result,ExitCode=timedOut?124:(int)code,Enforced=true};
    } finally {
      if(process.process!=IntPtr.Zero) { TerminateProcess(process.process,1); CloseHandle(process.process); }
      if(process.thread!=IntPtr.Zero) CloseHandle(process.thread);
      foreach(IntPtr h in new[]{job,original,token,impersonation,ro,wo,re,we}) if(h!=IntPtr.Zero) CloseHandle(h);
      foreach(IntPtr s in new[]{admin,restrict,low}) if(s!=IntPtr.Zero) LocalFree(s);
    }
  }
}
`;
