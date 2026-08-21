import React from 'react';
export const Card=({children,className=''})=><section className={`card ${className}`}>{children}</section>;
export const PageHeader=({title,subtitle,actions})=><div className="page-head"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{actions&&<div className="page-actions">{actions}</div>}</div>;
export const Button=({children,variant='secondary',className='',...p})=><button className={`btn ${variant} ${className}`} {...p}>{children}</button>;
export const Badge=({children,tone='blue'})=><span className={`badge ${tone}`}>{children}</span>;
export const Empty=({title='لا توجد بيانات',text='لم يتم العثور على سجلات لعرضها.'})=><div className="empty"><div className="empty-icon">◇</div><strong>{title}</strong><span>{text}</span></div>;
export const Loading=({text='جاري التحميل...'})=><div className="loading"><span className="spinner"/>{text}</div>;
export const ErrorBox=({error})=>error?<div className="error-box">{String(error)}</div>:null;
export function Modal({open,onClose,title,children,wide=false}){if(!open)return null;return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose?.()}}><div className={`modal ${wide?'wide':''}`}><div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}>×</button></div><div className="modal-body">{children}</div></div></div>}
export const Field=({label,children,hint})=><label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;
export const Input=(p)=><input {...p}/>; export const Select=(p)=><select {...p}/>; export const Textarea=(p)=><textarea {...p}/>;
export function Table({columns,rows,onRow}){return <div className="table-wrap"><table><thead><tr>{columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.id||r.booking_number||r.trip_code||i} onClick={()=>onRow?.(r)} className={onRow?'clickable':''}>{columns.map(c=><td key={c.key}>{c.render?c.render(r):r[c.key]??'—'}</td>)}</tr>)}</tbody></table></div>}
