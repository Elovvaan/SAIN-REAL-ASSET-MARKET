(function(){
  function escapeHtml(value){
    return String(value??'')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');
  }

  function inlineMarkdown(value){
    return escapeHtml(value)
      .replace(/`([^`]+)`/g,'<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
      .replace(/__([^_]+)__/g,'<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g,'<em>$1</em>');
  }

  function renderMarkdown(value){
    const lines=String(value??'').replace(/\r/g,'').split('\n');
    const blocks=[];
    let list=[];
    let paragraph=[];

    function flushParagraph(){
      if(!paragraph.length)return;
      blocks.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph=[];
    }
    function flushList(){
      if(!list.length)return;
      blocks.push(`<ul>${list.map(item=>`<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
      list=[];
    }

    for(const raw of lines){
      const line=raw.trim();
      if(!line){flushParagraph();flushList();continue;}
      const heading=line.match(/^#{1,3}\s+(.+)$/);
      const bullet=line.match(/^[-*•]\s+(.+)$/);
      if(heading){flushParagraph();flushList();blocks.push(`<h3>${inlineMarkdown(heading[1])}</h3>`);continue;}
      if(bullet){flushParagraph();list.push(bullet[1]);continue;}
      flushList();
      paragraph.push(line);
    }
    flushParagraph();
    flushList();
    return blocks.join('');
  }

  function splitForDisclosure(text){
    const normalized=String(text??'').trim();
    if(normalized.length<=1200)return{summary:normalized,details:''};
    const paragraphs=normalized.split(/\n\s*\n/).filter(Boolean);
    if(paragraphs.length>2){
      return{summary:paragraphs.slice(0,2).join('\n\n'),details:paragraphs.slice(2).join('\n\n')};
    }
    const cut=normalized.lastIndexOf(' ',1000);
    const index=cut>600?cut:1000;
    return{summary:normalized.slice(0,index).trim(),details:normalized.slice(index).trim()};
  }

  window.appendMessage=function(text,type){
    const message=document.createElement('div');
    message.className=`message ${type==='user'?'user-message':'sane-message'}`;

    if(type==='user'){
      message.textContent=text;
    }else{
      const parts=splitForDisclosure(text);
      const body=document.createElement('div');
      body.className='sane-response-body';
      body.innerHTML=renderMarkdown(parts.summary);
      message.append(body);

      if(parts.details){
        const disclosure=document.createElement('details');
        disclosure.className='sane-response-details';
        const summary=document.createElement('summary');
        summary.textContent='Show full explanation';
        const detailsBody=document.createElement('div');
        detailsBody.className='sane-response-body sane-response-expanded';
        detailsBody.innerHTML=renderMarkdown(parts.details);
        disclosure.append(summary,detailsBody);
        message.append(disclosure);
      }
    }

    const chatLog=document.querySelector('#chat-log');
    chatLog.append(message);
    chatLog.scrollTop=chatLog.scrollHeight;
  };
})();
