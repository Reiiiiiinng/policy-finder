import sys
import unittest
from test_v32 import V32
from followup_api import FollowupError
from uuid import uuid4

class DraftScope(V32):
    def test_atomic_draft_submission(self):
        identifier=str(uuid4())
        form=dict(id=identifier,memberId=self.member,description='合成草稿',age=68,region='佛山市')
        self.assertEqual(self.post('draft',revision=0,**form)['revision'],1)
        other=self.get('draft',memberId=self.other,id=identifier)
        self.assertIsNone(other['draft'])
        self.assertEqual(self.get('draft',memberId=self.member,id=identifier)['draft']['description'],'合成草稿')
        self.assertEqual(self.post('draft',revision=1,**dict(form,description='合成新版本'))['revision'],2)
        with self.assertRaises(FollowupError):
            self.post('create',draftRevision=1,**form)
        self.post('create',draftRevision=2,**dict(form,description='合成新版本'))
        self.assertIsNone(self.get('draft',memberId=self.member,id=identifier)['draft'])
        with self.assertRaises(FollowupError):
            self.post('draft',revision=2,**form)

if __name__ == "__main__":
    suite = unittest.TestSuite([DraftScope("test_atomic_draft_submission")])
    sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
